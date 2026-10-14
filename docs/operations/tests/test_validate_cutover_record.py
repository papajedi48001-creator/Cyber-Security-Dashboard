"""Tests for validate_cutover_record.py.

Run: python3 -m unittest discover -s docs/operations/tests
"""
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import validate_cutover_record as v  # noqa: E402

TEMPLATE = (HERE.parent / "sophos-cutover-record.md").read_text()

COMPLETE = {
    "approval.approver": "Synthetic Approver, IT Manager",
    "approval.date": "2026-11-01",
    "approval.reference": "MEMO-TEST-001",
    "rehearsal.date": "2026-10-28",
    "ingestion.result": "pass",
    "ingestion.evidence": "screenshot-ingestion.png",
    "detection.result": "pass",
    "detection.evidence": "logtest_check output 2026-10-28",
    "detection.events_dropped": "0",
    "source_health.result": "pass",
    "source_health.evidence": "relay stopped 10:00, alert 100181 at 10:02",
    "notification.result": "pass",
    "notification.evidence": "LINE and email test messages 10:05",
    "recovery.elapsed_hours": "6.5",
    "recovery.evidence": "restore rehearsal log",
    "rollback.method": "restore FortiSIEM image and point relay back",
    "rollback.tested": "yes",
    "rollback.elapsed_hours": "3",
    "log_gap.start": "2026-11-02T01:00+07:00",
    "log_gap.end": "2026-11-02T05:30+07:00",
}


def record(values):
    rows = "\n".join(f"| `{k}` | {val} |" for k, val in values.items())
    return f"# Cutover record\n\n| Field | Value |\n|---|---|\n{rows}\n"


class ValidateCutoverRecordTests(unittest.TestCase):
    def test_blank_template_is_rejected(self):
        self.assertTrue(v.validate(TEMPLATE))

    def test_template_lists_every_required_field(self):
        self.assertEqual(set(v.parse(TEMPLATE)), set(v.REQUIRED))

    def test_complete_record_passes(self):
        self.assertEqual(v.validate(record(COMPLETE)), [])

    def test_each_missing_required_field_is_reported(self):
        for key in ("rollback.tested", "source_health.result", "notification.evidence", "approval.approver"):
            with self.subTest(key=key):
                values = dict(COMPLETE)
                values[key] = ""
                self.assertTrue(any(key in e for e in v.validate(record(values))))

    def test_failed_result_is_rejected(self):
        values = dict(COMPLETE, **{"notification.result": "fail"})
        self.assertTrue(v.validate(record(values)))

    def test_untested_rollback_is_rejected(self):
        values = dict(COMPLETE, **{"rollback.tested": "no"})
        self.assertTrue(v.validate(record(values)))

    def test_dropped_events_are_rejected(self):
        values = dict(COMPLETE, **{"detection.events_dropped": "12"})
        self.assertTrue(v.validate(record(values)))

    def test_recovery_over_24_hours_is_rejected(self):
        values = dict(COMPLETE, **{"recovery.elapsed_hours": "30"})
        self.assertTrue(v.validate(record(values)))

    def test_log_gap_end_must_follow_start(self):
        values = dict(COMPLETE, **{"log_gap.end": "2026-11-01T23:00+07:00"})
        self.assertTrue(v.validate(record(values)))


if __name__ == "__main__":
    unittest.main()
