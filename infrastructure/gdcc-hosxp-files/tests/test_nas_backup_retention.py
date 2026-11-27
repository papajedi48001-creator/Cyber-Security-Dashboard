"""Tests for the NAS backup retention job (keeps the newest complete HOSxP backup sets).

Run: python3 -m unittest discover -s infrastructure/gdcc-hosxp-files/tests
All names use the documentation address 192.0.2.10; no real hosts.
"""
import json
import os
import pathlib
import sys
import tempfile
import time
import unittest

TOOL_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL_DIR))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import nas_backup_retention as nr  # noqa: E402
import test_hosxp_offsite  # noqa: E402

make_zip = test_hosxp_offsite.make_zip

NOW = time.time()


def zip_name(day):
    return "MySQL_backup_192.0.2.10_11093_202611{:02d}000103.ZIP".format(day)


def log_name(day):
    return "MySQL_backup_192.0.2.10_hos_202611{:02d}000103_log.txt".format(day)


class RetentionTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = pathlib.Path(self.tmp.name) / "HOSxP_Backup_Daily"
        self.folder.mkdir()
        self.status = self.folder / "hosxp-nas-status.json"

    def tearDown(self):
        self.tmp.cleanup()

    def add_set(self, day, complete=True, age_minutes=600):
        make_zip(self.folder, zip_name(day), 2048, age_minutes, complete=complete)
        log = self.folder / log_name(day)
        log.write_text("Start Backup Table : zbm_rpst_name\n")
        stamp = NOW - age_minutes * 60
        os.utime(log, (stamp, stamp))

    def run_job(self, keep=3, dry_run=False):
        return nr.run(nr.Options(self.folder, self.status, keep_count=keep, settle_minutes=60, dry_run=dry_run),
                      now=NOW)

    def names(self):
        return sorted(p.name for p in self.folder.iterdir())

    def read_status(self):
        return json.loads(self.status.read_text())

    def test_keeps_the_newest_sets_and_deletes_older_zip_and_log(self):
        for day in range(20, 26):
            self.add_set(day)
        self.assertEqual(self.run_job(keep=3), 0)
        kept = [zip_name(d) for d in (23, 24, 25)] + [log_name(d) for d in (23, 24, 25)]
        self.assertEqual(self.names(), sorted(kept + ["hosxp-nas-status.json"]))

    def test_a_broken_zip_does_not_count_towards_the_kept_sets(self):
        for day in range(20, 26):
            self.add_set(day, complete=(day != 24))
        self.run_job(keep=3)
        names = self.names()
        for day in (22, 23, 24, 25):
            self.assertIn(zip_name(day), names)
        for day in (20, 21):
            self.assertNotIn(zip_name(day), names)
            self.assertNotIn(log_name(day), names)
        self.assertEqual(self.read_status()["complete_sets"], 3)

    def test_deletes_nothing_when_there_are_fewer_complete_sets_than_keep(self):
        for day in range(20, 24):
            self.add_set(day, complete=(day % 2 == 0))
        before = self.names()
        self.assertEqual(self.run_job(keep=3), 0)
        self.assertEqual([n for n in self.names() if n != "hosxp-nas-status.json"], before)
        status = self.read_status()
        self.assertEqual(status["deleted_files"], [])
        self.assertTrue(status["last_run_ok"])

    def test_a_zip_still_being_written_is_neither_counted_nor_deleted(self):
        for day in range(20, 24):
            self.add_set(day)
        self.add_set(26, age_minutes=5)
        self.run_job(keep=3)
        names = self.names()
        self.assertIn(zip_name(26), names)
        self.assertIn(zip_name(21), names)
        self.assertNotIn(zip_name(20), names)

    def test_leaves_other_files_alone(self):
        for day in range(20, 26):
            self.add_set(day)
        (self.folder / "notes.txt").write_text("x")
        (self.folder / "patient-export.sql").write_text("x")
        sub = self.folder / "older"
        sub.mkdir()
        make_zip(sub, zip_name(1), 2048, 9000)
        self.run_job(keep=3)
        self.assertIn("notes.txt", self.names())
        self.assertIn("patient-export.sql", self.names())
        self.assertTrue((sub / zip_name(1)).exists())

    def test_dry_run_deletes_nothing_but_reports_what_it_would_delete(self):
        for day in range(20, 26):
            self.add_set(day)
        before = self.names()
        self.run_job(keep=3, dry_run=True)
        self.assertEqual([n for n in self.names() if n != "hosxp-nas-status.json"], before)
        self.assertIn(zip_name(20), self.read_status()["deleted_files"])

    def test_writes_the_agreed_status_shape(self):
        for day in range(20, 26):
            self.add_set(day)
        self.run_job(keep=3)
        status = self.read_status()
        self.assertEqual(status["schema"], 1)
        self.assertRegex(status["generated_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual(status["keep_count"], 3)
        self.assertEqual(status["complete_sets"], 3)
        self.assertEqual(status["newest_set_date"], "2026-11-25")
        self.assertEqual(status["oldest_set_date"], "2026-11-23")
        self.assertEqual([s["date"] for s in status["sets"]], ["2026-11-25", "2026-11-24", "2026-11-23"])
        self.assertEqual(status["sets"][0]["zip_name"], zip_name(25))
        self.assertEqual(status["sets"][0]["zip_bytes"], 2048)
        self.assertEqual(sorted(status["deleted_files"]),
                         sorted([zip_name(d) for d in (20, 21, 22)] + [log_name(d) for d in (20, 21, 22)]))
        self.assertGreater(status["total_bytes"], 0)
        self.assertGreaterEqual(status["free_bytes"], 0)
        self.assertTrue(status["last_run_ok"])
        self.assertIsNone(status["error"])
        self.assertLess(self.status.stat().st_size, 256 * 1024)

    def test_reports_failure_without_paths_when_the_folder_is_missing(self):
        status_path = pathlib.Path(self.tmp.name) / "status.json"
        code = nr.run(nr.Options(pathlib.Path(self.tmp.name) / "gone", status_path, keep_count=3), now=NOW)
        self.assertEqual(code, 2)
        status = json.loads(status_path.read_text())
        self.assertFalse(status["last_run_ok"])
        self.assertEqual(status["sets"], [])
        self.assertNotIn(self.tmp.name, status["error"])
        self.assertNotIn("/", status["error"])

    def test_refuses_a_keep_count_below_one(self):
        with self.assertRaises(ValueError):
            nr.Options(self.folder, self.status, keep_count=0)


if __name__ == "__main__":
    unittest.main()
