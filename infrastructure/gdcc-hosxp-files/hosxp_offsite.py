#!/usr/bin/env python3
"""Copy the HOSxP daily backup ZIP files to GDCC and keep the GDCC disk from filling (ADR 0010).

Two commands, one per machine:

upload (HOSxP server, after the nightly backup has finished)
    Sends each finished ZIP from the last few days that has not been sent yet,
    over SFTP with a key that can only write into the GDCC inbox. Each file is
    written under a dot name and renamed when complete, together with a SHA-256
    sidecar. A file much smaller than the recent ones, or whose ZIP directory
    cannot be read (the backup stopped mid-write), is not sent: it is recorded
    as FAILED. The inner table files are password-protected by the HOSxP backup
    program, so their contents cannot be tested here; the password is kept off
    the GDCC VM.
    One Backup Evidence line per file goes to an outbox for the Portal:

        job,result,completed_at,size_bytes,encrypted,retention_until

store (GDCC VM, every few minutes)
    Verifies each complete upload against its checksum and moves it into a
    root-only directory the upload account cannot read or delete. Then, while
    the encrypted volume is fuller than the limit, deletes the oldest backup,
    always keeping the newest ones.

Standard library only; runs on Python 3.6 (EL8) and later. Never prints the
GDCC address or key path.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

JOB = "hosxp-daily-zip"
HEADER = "job,result,completed_at,size_bytes,encrypted,retention_until"
BACKUP_NAME = re.compile(r"^MySQL_backup_[A-Za-z0-9._-]+\.zip$", re.IGNORECASE)
REMOTE_INBOX = "/inbox"
SFTP_TIMEOUT_SECONDS = 12 * 3600
PARTIAL_MAX_AGE_SECONDS = 2 * 86400
HISTORY = 7
NAS_STATUS_NAME = "hosxp-nas-status.json"
NAS_STATUS_MAX_BYTES = 256 * 1024


class UploadOptions(object):
    def __init__(self, source, state, outbox, destination, key, settle_minutes=30, lookback_days=2,
                 min_bytes=1024 ** 3, min_ratio=0.5, env=None, nas_status=None):
        self.source = Path(source)
        self.state = Path(state)
        self.outbox = Path(outbox)
        self.destination = destination
        self.key = key
        self.settle_minutes = settle_minutes
        self.lookback_days = lookback_days
        self.min_bytes = min_bytes
        self.min_ratio = min_ratio
        self.env = dict(os.environ if env is None else env)
        self.nas_status = Path(nas_status) if nas_status else None


class StoreOptions(object):
    def __init__(self, inbox, store, keep_min=2, max_use_percent=85.0):
        self.inbox = Path(inbox)
        self.store = Path(store)
        self.keep_min = keep_min
        self.max_use_percent = max_use_percent


def log(event, **detail):
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    detail = {k: v for k, v in detail.items() if v is not None}
    print(json.dumps(dict({"at": stamp, "event": event}, **detail), ensure_ascii=False), file=sys.stderr)


def redact(text, destination):
    host = destination.split("@")[-1]
    for value in (destination, host):
        if value:
            text = text.replace(value, "<gdcc>")
    return " ".join(text.split())[:300]


def sha256_of(path):
    digest = hashlib.sha256()
    with open(str(path), "rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _iso(timestamp):
    return dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_state(path):
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        data = {}
    data.setdefault("uploaded", {})
    data.setdefault("rejected", {})
    return data


def _save_state(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".", dir=str(path.parent))
    with os.fdopen(fd, "w") as handle:
        json.dump(data, handle, indent=1, sort_keys=True)
    os.replace(temp, str(path))


def _write_evidence(outbox, rows):
    """rows: (result, completed_epoch, size, encrypted). Temp name then rename, so readers never see half a file."""
    outbox.mkdir(parents=True, exist_ok=True)
    host = re.sub(r"[^A-Za-z0-9.-]", "-", socket.gethostname())[:64] or "host"
    final = outbox / "{}-hosxp-{}.csv".format(host, time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    lines = [HEADER] + ["{},{},{},{},{},".format(JOB, r, _iso(t), s, "yes" if e else "no") for r, t, s, e in rows]
    fd, temp = tempfile.mkstemp(prefix=".", suffix=".tmp", dir=str(outbox))
    with os.fdopen(fd, "w") as handle:
        handle.write("\n".join(lines) + "\n")
    os.chmod(temp, 0o640)
    os.replace(temp, str(final))


def _candidates(options, now):
    settled_before = now - options.settle_minutes * 60
    oldest = now - options.lookback_days * 86400
    found = []
    for entry in options.source.iterdir():
        if not BACKUP_NAME.match(entry.name) or not entry.is_file():
            continue
        info = entry.stat()
        if oldest <= info.st_mtime <= settled_before:
            found.append((info.st_mtime, entry, info.st_size))
    return sorted(found)


def zip_is_complete(path):
    """True when the ZIP's central directory can be read and lists at least one file.
    Reads only the end of the file, so it is quick even for a 35 GB backup."""
    try:
        with zipfile.ZipFile(str(path)) as archive:
            return len(archive.infolist()) > 0
    except (zipfile.BadZipFile, OSError, ValueError):
        return False


def _baseline(state):
    sizes = [size for _, size in sorted(state["uploaded"].items())][-HISTORY:]
    if not sizes:
        return None
    sizes.sort()
    return sizes[len(sizes) // 2]


def _sftp(options, local, sidecar, name):
    part, sum_part = "{}/.{}.part".format(REMOTE_INBOX, name), "{}/.{}.sha256.part".format(REMOTE_INBOX, name)
    batch = "\n".join([
        "-rm " + part,
        "put {} {}".format(local, part),
        "put {} {}".format(sidecar, sum_part),
        "rename {} {}/{}.sha256".format(sum_part, REMOTE_INBOX, name),
        "rename {} {}/{}".format(part, REMOTE_INBOX, name),
    ]) + "\n"
    return subprocess.run(_sftp_command(options), input=batch, env=options.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          universal_newlines=True, timeout=SFTP_TIMEOUT_SECONDS, check=False)


def _sftp_command(options):
    return ["sftp", "-b", "-", "-i", options.key, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
            "-o", "ServerAliveInterval=30", options.destination]


def send_nas_status(options):
    """Send the NAS retention status file (written on the NAS by nas_backup_retention.py) to the
    GDCC inbox under a fixed name, replacing the previous one. Returns an error string or None."""
    try:
        if options.nas_status.stat().st_size > NAS_STATUS_MAX_BYTES:
            return "status file too large"
        raw = options.nas_status.read_bytes()
        data = json.loads(raw.decode("utf-8"))
    except OSError:
        return "status file not readable"
    except ValueError:  # includes UnicodeDecodeError
        return "status file is not JSON"
    if not isinstance(data, dict):
        return "status file is not a JSON object"
    with tempfile.TemporaryDirectory() as work:
        local = Path(work) / NAS_STATUS_NAME
        local.write_bytes(raw)
        part = "{}/.{}.part".format(REMOTE_INBOX, NAS_STATUS_NAME)
        batch = "\n".join([
            "-rm " + part,
            "put {} {}".format(local, part),
            "rename {} {}/{}".format(part, REMOTE_INBOX, NAS_STATUS_NAME),
        ]) + "\n"
        try:
            result = subprocess.run(_sftp_command(options), input=batch, env=options.env, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, universal_newlines=True, timeout=600, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return exc.__class__.__name__
    return None if result.returncode == 0 else redact(result.stderr, options.destination)


def upload(options, now=None):
    now = time.time() if now is None else now
    state = _load_state(options.state)
    rows = []
    status = 0
    for mtime, path, size in _candidates(options, now):
        name = path.name
        if name in state["uploaded"] or name in state["rejected"]:
            continue
        baseline = _baseline(state)
        floor = max(options.min_bytes, int(baseline * options.min_ratio) if baseline else 0)
        if size < floor:
            state["rejected"][name] = size
            rows.append(("FAILED", now, size, False))
            log("upload.rejected", file=name, size_bytes=size, expected_at_least=floor)
            status = 1
            continue
        if not zip_is_complete(path):
            state["rejected"][name] = size
            rows.append(("FAILED", now, size, False))
            log("upload.rejected", file=name, size_bytes=size, reason="zip directory unreadable")
            status = 1
            continue
        with tempfile.TemporaryDirectory() as work:
            sidecar = Path(work) / (name + ".sha256")
            sidecar.write_text("{}  {}\n".format(sha256_of(path), name))
            try:
                result = _sftp(options, str(path), str(sidecar), name)
                error = None if result.returncode == 0 else redact(result.stderr, options.destination)
            except (OSError, subprocess.TimeoutExpired) as exc:
                error = exc.__class__.__name__
        if error:
            rows.append(("FAILED", time.time(), size, False))
            log("upload.failed", file=name, detail=error)
            status = 1
            continue
        state["uploaded"][name] = size
        rows.append(("SUCCESS", time.time(), size, True))
        log("upload.done", file=name, size_bytes=size)
    for table in ("uploaded", "rejected"):
        keep = sorted(state[table])[-60:]
        state[table] = {k: state[table][k] for k in keep}
    _save_state(options.state, state)
    if rows:
        _write_evidence(options.outbox, rows)
    if options.nas_status is not None:
        error = send_nas_status(options)
        if error:
            log("nas_status.failed", detail=error)
            status = 1
        else:
            log("nas_status.sent")
    return status


def disk_used_percent(path):
    usage = shutil.disk_usage(str(path))
    return 100.0 * usage.used / usage.total


def store(options, disk_used_percent=disk_used_percent, on_delete=None, now=None):
    now = time.time() if now is None else now
    result = {"stored": [], "corrupt": [], "pruned": []}
    for entry in sorted(options.inbox.iterdir()):
        if entry.name.startswith("."):
            if now - entry.stat().st_mtime > PARTIAL_MAX_AGE_SECONDS:
                entry.unlink()
                log("store.partial_removed", file=entry.name)
            continue
        if not BACKUP_NAME.match(entry.name):
            continue
        sidecar = options.inbox / (entry.name + ".sha256")
        if not sidecar.exists():
            continue
        expected = (sidecar.read_text().split() or [""])[0].lower()
        if sha256_of(entry) != expected:
            entry.unlink()
            sidecar.unlink()
            result["corrupt"].append(entry.name)
            log("store.corrupt", file=entry.name)
            continue
        target = options.store / entry.name
        os.replace(str(entry), str(target))
        os.replace(str(sidecar), str(options.store / sidecar.name))
        for moved in (target, options.store / sidecar.name):
            os.chmod(str(moved), 0o600)
            if os.geteuid() == 0:
                os.chown(str(moved), 0, 0)
        result["stored"].append(entry.name)
        log("store.stored", file=entry.name, size_bytes=target.stat().st_size)
    backups = sorted(p for p in options.store.iterdir() if BACKUP_NAME.match(p.name))
    while len(backups) > options.keep_min and disk_used_percent(options.store) > options.max_use_percent:
        oldest = backups.pop(0)
        oldest.unlink()
        sidecar = options.store / (oldest.name + ".sha256")
        if sidecar.exists():
            sidecar.unlink()
        result["pruned"].append(oldest.name)
        log("store.pruned", file=oldest.name)
        if on_delete:
            on_delete(oldest)
    log("store.summary", stored=len(result["stored"]), corrupt=len(result["corrupt"]), pruned=len(result["pruned"]),
        kept=len(backups), used_percent=round(disk_used_percent(options.store), 1))
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description="Copy HOSxP daily backup files to GDCC (ADR 0010).")
    sub = parser.add_subparsers(dest="command")
    up = sub.add_parser("upload", help="HOSxP server: send finished backups to the GDCC inbox")
    up.add_argument("--source", required=True)
    up.add_argument("--state", required=True)
    up.add_argument("--outbox", required=True)
    up.add_argument("--destination", required=True, help="user@host of the GDCC upload account")
    up.add_argument("--key", required=True)
    up.add_argument("--settle-minutes", type=int, default=30)
    up.add_argument("--lookback-days", type=int, default=2)
    up.add_argument("--min-gib", type=float, default=1.0)
    up.add_argument("--min-ratio", type=float, default=0.5)
    up.add_argument("--nas-status", help="NAS retention status JSON to send to GDCC on every run")
    st = sub.add_parser("store", help="GDCC VM: verify uploads, move them to the store, prune when full")
    st.add_argument("--inbox", required=True)
    st.add_argument("--store", required=True)
    st.add_argument("--keep-min", type=int, default=2)
    st.add_argument("--max-use-percent", type=float, default=85.0)
    args = parser.parse_args(argv)
    if args.command == "upload":
        return upload(UploadOptions(args.source, args.state, args.outbox, args.destination, args.key,
                                    args.settle_minutes, args.lookback_days, int(args.min_gib * 1024 ** 3),
                                    args.min_ratio, nas_status=args.nas_status))
    if args.command == "store":
        for path in (args.inbox, args.store):
            if not os.path.isdir(path):
                log("store.error", message="directory missing (encrypted volume locked?)", path=path)
                return 2
        store(StoreOptions(args.inbox, args.store, args.keep_min, args.max_use_percent))
        return 0
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
