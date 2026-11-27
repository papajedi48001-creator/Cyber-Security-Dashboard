#!/usr/bin/env python3
"""Keep the newest complete HOSxP backup sets on the NAS and delete older ones (ADR 0010).

Runs on the NAS itself (Synology Task Scheduler, as root, once a day after the
nightly ZIP has finished), because the HOSxP server mounts the share read-only.

A backup set is one ZIP and its table log, paired by the timestamp in the name:

    MySQL_backup_<host>_<port>_<YYYYMMDDhhmmss>.ZIP
    MySQL_backup_<host>_hos_<YYYYMMDDhhmmss>_log.txt

Rules:
- Only sets whose ZIP directory can be read count as complete. A ZIP cut short
  (the backup stopped mid-write) never counts, so it cannot push a good set out.
- When there are at least --keep complete sets, every set older than the oldest
  kept complete set is deleted (ZIP and log). With fewer, nothing is deleted.
- Files changed in the last --settle-minutes are never counted or deleted.
- Only files in the folder itself whose names match the patterns above are
  touched; sub-folders, symlinks and other files are left alone.

Each run writes a status file (JSON, schema 1) that the HOSxP upload job sends
to GDCC for the Portal's read-only NAS view. It carries no paths or addresses
apart from the backup file names. --dry-run reports what would be deleted
without deleting it.

Standard library only; Python 3.6 or later.
"""
import argparse
import datetime as dt
import json
import os
import re
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path

SCHEMA = 1
ZIP_NAME = re.compile(r"^MySQL_backup_[A-Za-z0-9._-]+_(\d{14})\.zip$", re.IGNORECASE)
LOG_NAME = re.compile(r"^MySQL_backup_[A-Za-z0-9._-]+_(\d{14})_log\.txt$", re.IGNORECASE)


class Options(object):
    def __init__(self, folder, status, keep_count=15, settle_minutes=60, dry_run=False):
        if int(keep_count) < 1:
            raise ValueError("keep_count must be at least 1")
        self.folder = Path(folder)
        self.status = Path(status)
        self.keep_count = int(keep_count)
        self.settle_minutes = settle_minutes
        self.dry_run = dry_run


def _utc(timestamp):
    return dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _date(stamp):
    return "{}-{}-{}".format(stamp[0:4], stamp[4:6], stamp[6:8])


def zip_is_complete(path):
    """True when the ZIP's central directory can be read and lists at least one file."""
    try:
        with zipfile.ZipFile(str(path)) as archive:
            return len(archive.infolist()) > 0
    except (zipfile.BadZipFile, OSError, ValueError):
        return False


def _scan(folder, settled_before):
    """Returns {stamp: {"zip": (path, size) or None, "logs": [path], "settled": bool}}."""
    sets = {}
    for entry in folder.iterdir():
        if entry.is_symlink() or not entry.is_file():
            continue
        zip_match, log_match = ZIP_NAME.match(entry.name), LOG_NAME.match(entry.name)
        if not (zip_match or log_match):
            continue
        stamp = (zip_match or log_match).group(1)
        info = entry.stat()
        item = sets.setdefault(stamp, {"zip": None, "logs": [], "settled": True})
        if info.st_mtime > settled_before:
            item["settled"] = False
        if zip_match:
            item["zip"] = (entry, info.st_size)
        else:
            item["logs"].append(entry)
    return sets


def _write_status(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".", suffix=".tmp", dir=str(path.parent))
    with os.fdopen(fd, "w") as handle:
        json.dump(data, handle, indent=1, sort_keys=True)
    os.chmod(temp, 0o644)
    os.replace(temp, str(path))


def _status(options, now, kept, deleted, ok, error):
    try:
        usage = shutil.disk_usage(str(options.folder))
        free, total = usage.free, usage.total
    except OSError:
        free, total = None, None
    sets = [{"date": _date(stamp), "zip_name": path.name, "zip_bytes": size} for stamp, path, size in kept]
    return {
        "schema": SCHEMA,
        "generated_at": _utc(now),
        "keep_count": options.keep_count,
        "complete_sets": len(kept),
        "newest_set_date": sets[0]["date"] if sets else None,
        "oldest_set_date": sets[-1]["date"] if sets else None,
        "sets": sets,
        "deleted_files": sorted(deleted),
        "free_bytes": free,
        "total_bytes": total,
        "last_run_ok": ok,
        "error": error,
        "dry_run": bool(options.dry_run),
    }


def run(options, now=None):
    now = time.time() if now is None else now
    if not options.folder.is_dir():
        _write_status(options.status, _status(options, now, [], [], False, "backup folder not found"))
        return 2
    sets = _scan(options.folder, now - options.settle_minutes * 60)
    complete = [(stamp, item["zip"][0], item["zip"][1]) for stamp, item in sets.items()
                if item["settled"] and item["zip"] and zip_is_complete(item["zip"][0])]
    complete.sort(key=lambda row: row[0], reverse=True)
    kept = complete[:options.keep_count]
    deleted, failed = [], 0
    if len(complete) >= options.keep_count:
        cutoff = kept[-1][0]
        for stamp in sorted(sets):
            item = sets[stamp]
            if stamp >= cutoff or not item["settled"]:
                continue
            targets = ([item["zip"][0]] if item["zip"] else []) + item["logs"]
            for path in targets:
                if not options.dry_run:
                    try:
                        path.unlink()
                    except OSError:
                        failed += 1
                        continue
                deleted.append(path.name)
    error = "{} file(s) could not be deleted".format(failed) if failed else None
    _write_status(options.status, _status(options, now, kept, deleted, failed == 0, error))
    print(json.dumps({"at": _utc(now), "kept": len(kept), "deleted": len(deleted), "failed": failed,
                      "dry_run": bool(options.dry_run)}))
    return 1 if failed else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Keep the newest complete HOSxP backup sets on the NAS.")
    parser.add_argument("--folder", required=True, help="folder holding the backup ZIPs and logs")
    parser.add_argument("--status", required=True, help="where to write the JSON status file")
    parser.add_argument("--keep", type=int, default=15, help="complete sets to keep (default 15)")
    parser.add_argument("--settle-minutes", type=int, default=60)
    parser.add_argument("--dry-run", action="store_true", help="report what would be deleted, delete nothing")
    args = parser.parse_args(argv)
    return run(Options(args.folder, args.status, args.keep, args.settle_minutes, args.dry_run))


if __name__ == "__main__":
    sys.exit(main())
