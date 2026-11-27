"""Tests for the GDCC restic backup wrapper.

Run: python3 -m unittest discover -s infrastructure/gdcc-backup/tests
A fake `restic` on PATH records its arguments and answers per FAKE_RESTIC_MODE.
"""
import datetime as dt
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import textwrap
import unittest

TOOL_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL_DIR))

import gdcc_backup  # noqa: E402

NOW = dt.datetime(2026, 11, 26, 18, 30, tzinfo=dt.timezone.utc)

FAKE_RESTIC = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    import json, os, sys
    with open(os.environ["FAKE_RESTIC_LOG"], "a") as log:
        log.write(json.dumps(sys.argv[1:]) + "\\n")
    mode = os.environ.get("FAKE_RESTIC_MODE", "ok")
    if sys.argv[1] == "backup":
        if mode == "fail":
            sys.stderr.write("Fatal: unable to open repository at s3:https://gdcc.example/secret-bucket\\n")
            sys.exit(1)
        print(json.dumps({"message_type": "status", "percent_done": 0.5}))
        if mode == "nosummary":
            print("not json at all")
            sys.exit(0)
        print(json.dumps({"message_type": "summary", "total_bytes_processed": 123456, "snapshot_id": "abc"}))
    sys.exit(0)
    """
)


def write_config(directory, body):
    path = pathlib.Path(directory) / "jobs.toml"
    path.write_text(textwrap.dedent(body))
    return path


VALID = """\
    [retention]
    keep_daily = 35
    keep_weekly = 12
    keep_monthly = 12
    check_subset = "5%"

    [[jobs]]
    name = "portal-mariadb-daily"
    pre = [["{pre}"]]
    paths = ["/var/backups/portal-db"]

    [[jobs]]
    name = "portal-config-daily"
    paths = ["/etc/portal"]
    keep_daily = 7
"""


class Harness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        bin_dir = self.dir / "bin"
        bin_dir.mkdir()
        restic = bin_dir / "restic"
        restic.write_text(FAKE_RESTIC)
        restic.chmod(restic.stat().st_mode | stat.S_IEXEC)
        self.log = self.dir / "restic.log"
        self.ok_pre = self.dir / "pre-ok.sh"
        self.ok_pre.write_text("#!/bin/sh\nexit 0\n")
        self.ok_pre.chmod(0o755)
        self.bad_pre = self.dir / "pre-bad.sh"
        self.bad_pre.write_text("#!/bin/sh\nexit 3\n")
        self.bad_pre.chmod(0o755)
        self.password = self.dir / "restic-password"
        self.password.write_text("synthetic-test-only\n")
        self.env = {
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "FAKE_RESTIC_LOG": str(self.log),
            "RESTIC_REPOSITORY": "s3:https://objects.gdcc.example/bucket/portal",
            "RESTIC_PASSWORD_FILE": str(self.password),
        }
        self.outbox = self.dir / "outbox"

    def tearDown(self):
        self.tmp.cleanup()

    def calls(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def config(self, pre=None):
        return gdcc_backup.load_config(write_config(self.dir, VALID.format(pre=pre or self.ok_pre)))


class ConfigTests(Harness):
    def test_loads_jobs_with_retention_defaults_and_overrides(self):
        config = self.config()
        self.assertEqual([j.name for j in config.jobs], ["portal-mariadb-daily", "portal-config-daily"])
        self.assertEqual(config.jobs[0].keep_daily, 35)
        self.assertEqual(config.jobs[1].keep_daily, 7)
        self.assertEqual(config.jobs[0].pre, [[str(self.ok_pre)]])

    def test_rejects_job_name_the_portal_would_reject(self):
        path = write_config(self.dir, '[retention]\nkeep_daily=1\nkeep_weekly=1\nkeep_monthly=1\n[[jobs]]\nname="bad name"\npaths=["/etc"]\n')
        with self.assertRaisesRegex(gdcc_backup.ConfigError, "name"):
            gdcc_backup.load_config(path)

    def test_rejects_relative_paths(self):
        path = write_config(self.dir, '[retention]\nkeep_daily=1\nkeep_weekly=1\nkeep_monthly=1\n[[jobs]]\nname="x"\npaths=["etc"]\n')
        with self.assertRaisesRegex(gdcc_backup.ConfigError, "absolute"):
            gdcc_backup.load_config(path)

    def test_requires_retention(self):
        path = write_config(self.dir, '[[jobs]]\nname="x"\npaths=["/etc"]\n')
        with self.assertRaisesRegex(gdcc_backup.ConfigError, "keep_daily"):
            gdcc_backup.load_config(path)

    def test_rejects_duplicate_job_names(self):
        path = write_config(self.dir, '[retention]\nkeep_daily=1\nkeep_weekly=1\nkeep_monthly=1\n[[jobs]]\nname="x"\npaths=["/a"]\n[[jobs]]\nname="x"\npaths=["/b"]\n')
        with self.assertRaisesRegex(gdcc_backup.ConfigError, "duplicate"):
            gdcc_backup.load_config(path)

    def test_example_config_is_valid(self):
        config = gdcc_backup.load_config(TOOL_DIR / "jobs.example.toml")
        self.assertTrue(config.jobs)


class EnvironmentTests(Harness):
    def test_refuses_password_in_environment(self):
        env = {**self.env, "RESTIC_PASSWORD": "x"}
        with self.assertRaisesRegex(gdcc_backup.ConfigError, "RESTIC_PASSWORD_FILE"):
            gdcc_backup.check_environment(env)

    def test_requires_repository_and_password_file(self):
        with self.assertRaisesRegex(gdcc_backup.ConfigError, "RESTIC_REPOSITORY"):
            gdcc_backup.check_environment({"RESTIC_PASSWORD_FILE": str(self.password)})
        with self.assertRaisesRegex(gdcc_backup.ConfigError, "RESTIC_PASSWORD_FILE"):
            gdcc_backup.check_environment({"RESTIC_REPOSITORY": "s3:x"})


class BackupTests(Harness):
    def run_job(self, job, mode="ok"):
        return gdcc_backup.run_job(job, now=lambda: NOW, env={**self.env, "FAKE_RESTIC_MODE": mode})

    def test_success_records_size_and_retention(self):
        evidence = self.run_job(self.config().jobs[0])
        self.assertEqual(evidence.result, "SUCCESS")
        self.assertEqual(evidence.size_bytes, 123456)
        self.assertTrue(evidence.encrypted)
        self.assertEqual(evidence.retention_until, NOW + dt.timedelta(days=35))
        backup = self.calls()[0]
        self.assertEqual(backup[:2], ["backup", "--json"])
        self.assertIn("job=portal-mariadb-daily", backup)
        self.assertEqual(backup[-1], "/var/backups/portal-db")

    def test_restic_failure_records_failed(self):
        evidence = self.run_job(self.config().jobs[0], mode="fail")
        self.assertEqual(evidence.result, "FAILED")
        self.assertIsNone(evidence.size_bytes)
        self.assertFalse(evidence.encrypted)

    def test_missing_summary_records_failed(self):
        self.assertEqual(self.run_job(self.config().jobs[0], mode="nosummary").result, "FAILED")

    def test_failed_pre_command_skips_restic(self):
        evidence = self.run_job(self.config(pre=self.bad_pre).jobs[0])
        self.assertEqual(evidence.result, "FAILED")
        self.assertEqual(self.calls(), [])

    def test_error_detail_never_contains_repository(self):
        evidence = self.run_job(self.config().jobs[0], mode="fail")
        self.assertNotIn("secret-bucket", evidence.detail)
        self.assertNotIn("gdcc.example", evidence.detail)


class EvidenceTests(unittest.TestCase):
    def test_csv_matches_portal_import_format(self):
        rows = [
            gdcc_backup.Evidence("a", "SUCCESS", NOW, 10, True, NOW + dt.timedelta(days=1)),
            gdcc_backup.Evidence("b", "FAILED", NOW, None, False, None),
        ]
        self.assertEqual(
            gdcc_backup.evidence_csv(rows),
            "job,result,completed_at,size_bytes,encrypted,retention_until\n"
            "a,SUCCESS,2026-11-26T18:30:00Z,10,yes,2026-11-27T18:30:00Z\n"
            "b,FAILED,2026-11-26T18:30:00Z,,no,\n",
        )


class CommandTests(Harness):
    def main(self, *args, mode="ok", pre=None):
        config = write_config(self.dir, VALID.format(pre=pre or self.ok_pre))
        return gdcc_backup.main(
            [args[0], "--config", str(config), *args[1:]],
            env={**self.env, "FAKE_RESTIC_MODE": mode},
            now=lambda: NOW,
        )

    def test_backup_writes_outbox_atomically(self):
        code = self.main("backup", "--outbox", str(self.outbox))
        self.assertEqual(code, 0)
        files = sorted(p.name for p in self.outbox.iterdir())
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].endswith(".csv"))
        self.assertFalse(files[0].startswith("."))
        lines = (self.outbox / files[0]).read_text().splitlines()
        self.assertEqual(len(lines), 3)
        self.assertTrue(lines[1].startswith("portal-mariadb-daily,SUCCESS,"))

    def test_backup_exits_nonzero_when_a_job_fails(self):
        self.assertEqual(self.main("backup", "--outbox", str(self.outbox), mode="fail"), 1)
        self.assertEqual(len(list(self.outbox.iterdir())), 1)

    def test_prune_forgets_per_job_then_checks(self):
        self.assertEqual(self.main("prune"), 0)
        calls = self.calls()
        self.assertEqual(
            calls[0],
            ["forget", "--tag", "job=portal-mariadb-daily", "--keep-daily", "35", "--keep-weekly", "12", "--keep-monthly", "12", "--prune"],
        )
        self.assertEqual(calls[1][:4], ["forget", "--tag", "job=portal-config-daily", "--keep-daily"])
        self.assertEqual(calls[1][4], "7")
        self.assertEqual(calls[-1], ["check", "--read-data-subset", "5%"])

    def test_cli_entry_point_runs(self):
        result = subprocess.run([sys.executable, str(TOOL_DIR / "gdcc_backup.py"), "--help"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn("backup", result.stdout)


if __name__ == "__main__":
    unittest.main()
