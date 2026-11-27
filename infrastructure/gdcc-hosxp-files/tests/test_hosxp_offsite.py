"""Tests for the HOSxP daily backup file offsite copy (ADR 0010).

Run: python3 -m unittest discover -s infrastructure/gdcc-hosxp-files/tests
A fake `sftp` on PATH plays the GDCC side: it applies put and rename to a local
directory that stands for the chroot.
"""
import datetime as dt
import hashlib
import json
import os
import pathlib
import stat
import sys
import tempfile
import textwrap
import time
import unittest
import zipfile

TOOL_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL_DIR))

import hosxp_offsite as ho  # noqa: E402

FAKE_SFTP = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    import os, shutil, sys
    root = os.environ["FAKE_SFTP_ROOT"]
    if os.environ.get("FAKE_SFTP_FAIL"):
        sys.stderr.write("ssh: connect to host gdcc.example port 22: Connection timed out\\n")
        sys.exit(255)
    with open(os.environ["FAKE_SFTP_LOG"], "a") as log:
        log.write(" ".join(sys.argv[1:]) + "\\n")
    for line in sys.stdin.read().splitlines():
        line = line.strip()
        if not line:
            continue
        tolerant = line.startswith("-")
        parts = line.lstrip("-").split()
        try:
            if parts[0] == "put":
                shutil.copyfile(parts[1], os.path.join(root, parts[2].lstrip("/")))
            elif parts[0] == "rename":
                os.replace(os.path.join(root, parts[1].lstrip("/")), os.path.join(root, parts[2].lstrip("/")))
            elif parts[0] == "rm":
                os.remove(os.path.join(root, parts[1].lstrip("/")))
        except OSError:
            if not tolerant:
                sys.exit(1)
    """
)

GIB = 1024 ** 3


def make_zip(directory, name, size, age_minutes, complete=True):
    """A real ZIP of exactly `size` bytes, or with complete=False the same bytes cut short
    (what a backup interrupted mid-write leaves behind)."""
    path = pathlib.Path(directory) / name
    inner = "acc_bank_type.ZIP"
    overhead = 30 + 46 + 22 + 2 * len(inner)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr(inner, os.urandom(max(size - overhead, 0)))
    if not complete:
        with open(path, "r+b") as handle:
            handle.truncate(path.stat().st_size - 40)
            handle.seek(0, 2)
            handle.write(os.urandom(40))
    stamp = time.time() - age_minutes * 60
    os.utime(path, (stamp, stamp))
    return path


class UploadTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(self.tmp.name)
        self.source = base / "source"
        self.remote = base / "remote"
        self.outbox = base / "outbox"
        self.bin = base / "bin"
        for d in (self.source, self.remote / "inbox", self.bin):
            d.mkdir(parents=True)
        self.state = base / "state.json"
        self.log = base / "sftp.log"
        sftp = self.bin / "sftp"
        sftp.write_text(FAKE_SFTP)
        sftp.chmod(sftp.stat().st_mode | stat.S_IEXEC)
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                        FAKE_SFTP_ROOT=str(self.remote), FAKE_SFTP_LOG=str(self.log))

    def tearDown(self):
        self.tmp.cleanup()

    def run_upload(self, **overrides):
        options = dict(source=self.source, state=self.state, outbox=self.outbox, destination="hosxp-upload@gdcc.example",
                       key="/etc/hosxp-offsite/upload_ed25519", settle_minutes=30, lookback_days=2,
                       min_bytes=1000, min_ratio=0.5, env=self.env)
        options.update(overrides)
        return ho.upload(ho.UploadOptions(**options))

    def evidence(self):
        files = sorted(self.outbox.glob("*.csv"))
        self.assertEqual(len(files), 1)
        return files[0].read_text().splitlines()

    def test_uploads_a_finished_backup_with_its_checksum_and_records_success(self):
        path = make_zip(self.source, "MySQL_backup_192.0.2.10_11093_20261126000103.ZIP", 4096, 90)
        self.assertEqual(self.run_upload(), 0)
        uploaded = self.remote / "inbox" / path.name
        self.assertEqual(uploaded.read_bytes(), path.read_bytes())
        sidecar = (self.remote / "inbox" / (path.name + ".sha256")).read_text().split()[0]
        self.assertEqual(sidecar, hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(list((self.remote / "inbox").glob(".*")), [])
        lines = self.evidence()
        self.assertEqual(lines[0], "job,result,completed_at,size_bytes,encrypted,retention_until")
        self.assertRegex(lines[1], r"^hosxp-daily-zip,SUCCESS,\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ,4096,yes,$")
        self.assertIn(path.name, json.loads(self.state.read_text())["uploaded"])

    def test_uploads_under_a_dot_name_then_renames(self):
        make_zip(self.source, "MySQL_backup_a_20261126000103.ZIP", 2048, 90)
        self.run_upload()
        batch = (self.log.read_text())
        self.assertIn("-b -", batch)
        self.assertIn("BatchMode=yes", batch)
        self.assertIn("StrictHostKeyChecking=yes", batch)

    def test_skips_a_file_still_being_written(self):
        make_zip(self.source, "MySQL_backup_a_20261126000103.ZIP", 2048, 5)
        self.assertEqual(self.run_upload(), 0)
        self.assertEqual(list((self.remote / "inbox").iterdir()), [])
        self.assertFalse(self.outbox.exists() and list(self.outbox.glob("*.csv")))

    def test_does_not_upload_twice(self):
        make_zip(self.source, "MySQL_backup_a_20261126000103.ZIP", 2048, 90)
        self.run_upload()
        self.log.unlink()
        for f in self.outbox.glob("*.csv"):
            f.unlink()
        self.assertEqual(self.run_upload(), 0)
        self.assertFalse(self.log.exists())

    def test_ignores_files_older_than_the_lookback_and_other_names(self):
        make_zip(self.source, "MySQL_backup_a_20261120000103.ZIP", 2048, 6 * 24 * 60)
        make_zip(self.source, "MySQL_backup_a_20261126000103_log.txt", 100, 90)
        make_zip(self.source, "patient.sql", 2048, 90)
        self.assertEqual(self.run_upload(), 0)
        self.assertEqual(list((self.remote / "inbox").iterdir()), [])

    def test_refuses_a_suspiciously_small_backup_and_records_failure(self):
        state = {"uploaded": {"MySQL_backup_a_20261124000104.ZIP": 4000, "MySQL_backup_a_20261123000104.ZIP": 4200}}
        self.state.write_text(json.dumps(state))
        make_zip(self.source, "MySQL_backup_a_20261125000104.ZIP", 1500, 90)
        self.assertEqual(self.run_upload(), 1)
        self.assertEqual(list((self.remote / "inbox").iterdir()), [])
        self.assertRegex(self.evidence()[1], r"^hosxp-daily-zip,FAILED,[^,]+,1500,no,$")
        self.assertIn("MySQL_backup_a_20261125000104.ZIP", json.loads(self.state.read_text())["rejected"])

    def test_refuses_a_file_below_the_absolute_minimum_without_history(self):
        make_zip(self.source, "MySQL_backup_a_20261125000104.ZIP", 500, 90)
        self.assertEqual(self.run_upload(), 1)
        self.assertRegex(self.evidence()[1], r",FAILED,")

    def test_refuses_a_backup_whose_zip_is_cut_short_and_records_failure(self):
        make_zip(self.source, "MySQL_backup_a_20261126000103.ZIP", 4096, 90, complete=False)
        self.assertEqual(self.run_upload(), 1)
        self.assertEqual(list((self.remote / "inbox").iterdir()), [])
        self.assertRegex(self.evidence()[1], r"^hosxp-daily-zip,FAILED,[^,]+,4096,no,$")
        self.assertIn("MySQL_backup_a_20261126000103.ZIP", json.loads(self.state.read_text())["rejected"])

    def test_records_failure_when_gdcc_is_unreachable_and_retries_next_run(self):
        make_zip(self.source, "MySQL_backup_a_20261126000103.ZIP", 2048, 90)
        env = dict(self.env, FAKE_SFTP_FAIL="1")
        self.assertEqual(self.run_upload(env=env), 1)
        self.assertRegex(self.evidence()[1], r"^hosxp-daily-zip,FAILED,")
        self.assertEqual(json.loads(self.state.read_text()).get("uploaded", {}), {})
        for f in self.outbox.glob("*.csv"):
            f.unlink()
        self.assertEqual(self.run_upload(), 0)
        self.assertTrue((self.remote / "inbox" / "MySQL_backup_a_20261126000103.ZIP").exists())

    def test_error_detail_never_contains_the_destination(self):
        detail = ho.redact("ssh: connect to host gdcc.example port 22: timed out for hosxp-upload@gdcc.example", "hosxp-upload@gdcc.example")
        self.assertNotIn("gdcc.example", detail)


class StoreTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(self.tmp.name)
        self.inbox = base / "inbox"
        self.store = base / "store"
        self.inbox.mkdir()
        self.store.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def deliver(self, name, data, checksum=None, age_minutes=0):
        (self.inbox / name).write_bytes(data)
        (self.inbox / (name + ".sha256")).write_text((checksum or hashlib.sha256(data).hexdigest()) + "  " + name + "\n")
        stamp = time.time() - age_minutes * 60
        os.utime(self.inbox / name, (stamp, stamp))

    def run_store(self, used_percent=50.0, keep_min=1, max_use_percent=85):
        usage = {"value": used_percent}

        def disk_used_percent(_path):
            return usage["value"]

        def on_delete(_path):
            usage["value"] -= 10

        return ho.store(ho.StoreOptions(inbox=self.inbox, store=self.store, keep_min=keep_min,
                                        max_use_percent=max_use_percent),
                        disk_used_percent=disk_used_percent, on_delete=on_delete)

    def test_moves_verified_files_into_the_store(self):
        self.deliver("MySQL_backup_a_20261126000103.ZIP", b"backup-bytes")
        result = self.run_store()
        self.assertEqual(result["stored"], ["MySQL_backup_a_20261126000103.ZIP"])
        self.assertEqual((self.store / "MySQL_backup_a_20261126000103.ZIP").read_bytes(), b"backup-bytes")
        self.assertEqual(list(self.inbox.iterdir()), [])
        self.assertEqual(stat.S_IMODE((self.store / "MySQL_backup_a_20261126000103.ZIP").stat().st_mode), 0o600)

    def test_deletes_a_file_whose_checksum_does_not_match(self):
        self.deliver("MySQL_backup_a_20261126000103.ZIP", b"corrupt", checksum="0" * 64)
        result = self.run_store()
        self.assertEqual(result["corrupt"], ["MySQL_backup_a_20261126000103.ZIP"])
        self.assertEqual(list(self.store.iterdir()), [])
        self.assertEqual(list(self.inbox.iterdir()), [])

    def test_waits_for_the_checksum_and_ignores_partial_uploads(self):
        (self.inbox / "MySQL_backup_a_20261126000103.ZIP").write_bytes(b"x")
        (self.inbox / ".MySQL_backup_b.ZIP.part").write_bytes(b"x")
        result = self.run_store()
        self.assertEqual(result["stored"], [])
        self.assertTrue((self.inbox / "MySQL_backup_a_20261126000103.ZIP").exists())
        self.assertTrue((self.inbox / ".MySQL_backup_b.ZIP.part").exists())

    def test_removes_partial_uploads_older_than_two_days(self):
        part = self.inbox / ".MySQL_backup_b.ZIP.part"
        part.write_bytes(b"x")
        old = time.time() - 3 * 86400
        os.utime(part, (old, old))
        self.run_store()
        self.assertFalse(part.exists())

    def test_prunes_oldest_backups_while_the_disk_is_too_full_keeping_the_newest(self):
        for day in ("22", "23", "24", "26"):
            (self.store / f"MySQL_backup_a_202611{day}000103.ZIP").write_bytes(b"x")
            (self.store / f"MySQL_backup_a_202611{day}000103.ZIP.sha256").write_text("x")
        result = self.run_store(used_percent=100.0)
        self.assertEqual(result["pruned"], ["MySQL_backup_a_20261122000103.ZIP", "MySQL_backup_a_20261123000103.ZIP"])
        remaining = sorted(p.name for p in self.store.glob("*.ZIP"))
        self.assertEqual(remaining, ["MySQL_backup_a_20261124000103.ZIP", "MySQL_backup_a_20261126000103.ZIP"])
        self.assertFalse((self.store / "MySQL_backup_a_20261122000103.ZIP.sha256").exists())

    def test_never_deletes_the_last_backups_even_when_full(self):
        (self.store / "MySQL_backup_a_20261126000103.ZIP").write_bytes(b"x")
        result = self.run_store(used_percent=99.0)
        self.assertEqual(result["pruned"], [])
        self.assertTrue((self.store / "MySQL_backup_a_20261126000103.ZIP").exists())

    def test_does_nothing_below_the_threshold(self):
        for day in ("22", "23"):
            (self.store / f"MySQL_backup_a_202611{day}000103.ZIP").write_bytes(b"x")
        self.assertEqual(self.run_store(used_percent=60.0)["pruned"], [])


if __name__ == "__main__":
    unittest.main()
