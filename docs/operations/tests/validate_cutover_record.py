#!/usr/bin/env python3
"""Validate a Sophos cutover record before asking for production acceptance.

Usage: python3 validate_cutover_record.py docs/operations/sophos-cutover-record.md
Exit code 0 only when every required field is filled and every check passed.
"""
import datetime
import re
import sys

ROW = re.compile(r"^\|\s*`([a-z_]+\.[a-z_]+)`\s*\|\s*(.*?)\s*\|\s*$")
PASS_FIELDS = ("ingestion.result", "detection.result", "source_health.result", "notification.result")
REQUIRED = (
    "approval.approver", "approval.date", "approval.reference",
    "rehearsal.date",
    "ingestion.result", "ingestion.evidence",
    "detection.result", "detection.evidence", "detection.events_dropped",
    "source_health.result", "source_health.evidence",
    "notification.result", "notification.evidence",
    "recovery.elapsed_hours", "recovery.evidence",
    "rollback.method", "rollback.tested", "rollback.elapsed_hours",
    "log_gap.start", "log_gap.end",
)
RECOVERY_OBJECTIVE_HOURS = 24


def parse(text):
    values = {}
    for line in text.splitlines():
        match = ROW.match(line.strip())
        if match:
            values[match.group(1)] = match.group(2)
    return values


def _number(value):
    try:
        return float(value)
    except ValueError:
        return None


def _time(value):
    try:
        return datetime.datetime.fromisoformat(value)
    except ValueError:
        return None


def validate(text):
    values = parse(text)
    errors = [f"{key}: missing" for key in REQUIRED if not values.get(key)]
    for key in PASS_FIELDS:
        if values.get(key) and values[key].lower() != "pass":
            errors.append(f"{key}: must be 'pass', got '{values[key]}'")
    if values.get("rollback.tested") and values["rollback.tested"].lower() != "yes":
        errors.append("rollback.tested: rollback must be rehearsed ('yes')")
    if values.get("detection.events_dropped") and _number(values["detection.events_dropped"]) != 0:
        errors.append("detection.events_dropped: must be 0")
    elapsed = _number(values.get("recovery.elapsed_hours") or "")
    if values.get("recovery.elapsed_hours") and (elapsed is None or elapsed > RECOVERY_OBJECTIVE_HOURS):
        errors.append(f"recovery.elapsed_hours: must be a number <= {RECOVERY_OBJECTIVE_HOURS}")
    start, end = _time(values.get("log_gap.start", "")), _time(values.get("log_gap.end", ""))
    if values.get("log_gap.start") and start is None:
        errors.append("log_gap.start: must be an ISO 8601 time")
    if values.get("log_gap.end") and end is None:
        errors.append("log_gap.end: must be an ISO 8601 time")
    if start and end and end <= start:
        errors.append("log_gap.end: must be after log_gap.start")
    return errors


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    with open(argv[1], encoding="utf-8") as handle:
        errors = validate(handle.read())
    for error in errors:
        print(f"FAIL {error}")
    print("cutover record complete" if not errors else f"{len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
