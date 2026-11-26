#!/usr/bin/env python3
"""Encrypted offsite backup to GDCC with restic, producing Backup Evidence.

ADR 0009. Each host runs `backup` from a systemd timer: for every configured
job it runs the job's pre-commands (for example a database dump), then
`restic backup`, and writes one Backup Evidence line per job into an outbox in
the CSV format the Portal imports:

    job,result,completed_at,size_bytes,encrypted,retention_until

restic encrypts on the client before anything leaves the hospital. The
repository password is read only from RESTIC_PASSWORD_FILE. Only the
maintenance host runs `prune`, with a credential that may delete.

The script never prints credentials, the repository location or the password.
"""
from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path
from typing import Callable, Mapping

NAME = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
HEADER = "job,result,completed_at,size_bytes,encrypted,retention_until"
DETAIL_LIMIT = 300
COMMAND_TIMEOUT_SECONDS = 6 * 3600


class ConfigError(Exception):
    """Invalid configuration or environment. Messages never include secret values."""


@dataclasses.dataclass(frozen=True)
class Job:
    name: str
    paths: list[str]
    pre: list[list[str]]
    exclude: list[str]
    keep_daily: int
    keep_weekly: int
    keep_monthly: int


@dataclasses.dataclass(frozen=True)
class Config:
    jobs: list[Job]
    check_subset: str


@dataclasses.dataclass(frozen=True)
class Evidence:
    job: str
    result: str  # SUCCESS or FAILED
    completed_at: dt.datetime
    size_bytes: int | None
    encrypted: bool
    retention_until: dt.datetime | None
    detail: str = ""


def _positive_int(table: Mapping, key: str, where: str) -> int:
    value = table.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ConfigError(f"{where}: {key} must be a positive integer")
    return value


def _string_list(value, where: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
        raise ConfigError(f"{where} must be a list of non-empty strings")
    return list(value)


def load_config(path: str | os.PathLike) -> Config:
    try:
        with open(path, "rb") as handle:
            data = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise ConfigError(f"cannot read config: {error.__class__.__name__}") from None

    retention = data.get("retention", {})
    defaults = {k: _positive_int(retention, k, "retention") for k in ("keep_daily", "keep_weekly", "keep_monthly")}
    check_subset = retention.get("check_subset", "5%")
    if not isinstance(check_subset, str) or not re.fullmatch(r"\d{1,3}(\.\d+)?%|\d+/\d+", check_subset):
        raise ConfigError("retention: check_subset must look like 5% or 1/10")

    raw_jobs = data.get("jobs")
    if not isinstance(raw_jobs, list) or not raw_jobs:
        raise ConfigError("at least one [[jobs]] entry is required")
    jobs: list[Job] = []
    for index, raw in enumerate(raw_jobs, start=1):
        where = f"jobs[{index}]"
        name = raw.get("name")
        if not isinstance(name, str) or not NAME.fullmatch(name):
            raise ConfigError(f"{where}: name must match A-Z a-z 0-9 . _ - (1-128 characters)")
        if any(j.name == name for j in jobs):
            raise ConfigError(f"{where}: duplicate job name {name}")
        paths = _string_list(raw.get("paths"), f"{where}.paths")
        if not paths or not all(p.startswith("/") for p in paths):
            raise ConfigError(f"{where}.paths must be absolute paths")
        pre = raw.get("pre", [])
        if not isinstance(pre, list):
            raise ConfigError(f"{where}.pre must be a list of commands")
        pre_commands = [_string_list(command, f"{where}.pre") for command in pre]
        if any(not command[0].startswith("/") for command in pre_commands):
            raise ConfigError(f"{where}.pre commands must use absolute paths")
        exclude = _string_list(raw.get("exclude", []), f"{where}.exclude") if raw.get("exclude") else []
        keep = {k: _positive_int(raw, k, where) if k in raw else v for k, v in defaults.items()}
        jobs.append(Job(name=name, paths=paths, pre=pre_commands, exclude=exclude, **keep))
    return Config(jobs=jobs, check_subset=check_subset)


def check_environment(env: Mapping[str, str]) -> None:
    if env.get("RESTIC_PASSWORD"):
        raise ConfigError("RESTIC_PASSWORD must not be set; use RESTIC_PASSWORD_FILE")
    if not env.get("RESTIC_REPOSITORY"):
        raise ConfigError("RESTIC_REPOSITORY is required")
    if not env.get("RESTIC_PASSWORD_FILE"):
        raise ConfigError("RESTIC_PASSWORD_FILE is required")


def _redact(text: str, env: Mapping[str, str]) -> str:
    """Short, single-line error text with the repository and credentials removed."""
    for key in ("RESTIC_REPOSITORY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "RESTIC_PASSWORD_FILE"):
        value = env.get(key)
        if value:
            text = text.replace(value, f"<{key}>")
    text = re.sub(r"\b(s3|sftp|rest|b2|azure|gs|swift|rclone):\S+", "<repository>", text)
    text = re.sub(r"https?://\S+", "<url>", text)
    return " ".join(text.split())[:DETAIL_LIMIT]


def _run(command: list[str], env: Mapping[str, str]) -> subprocess.CompletedProcess:
    return subprocess.run(command, env=dict(env), capture_output=True, text=True, timeout=COMMAND_TIMEOUT_SECONDS, check=False)


def _summary(stdout: str) -> dict | None:
    for line in reversed(stdout.splitlines()):
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(message, dict) and message.get("message_type") == "summary":
            return message
    return None


def run_job(job: Job, *, now: Callable[[], dt.datetime], env: Mapping[str, str]) -> Evidence:
    def failed(detail: str) -> Evidence:
        return Evidence(job.name, "FAILED", now(), None, False, None, detail)

    for command in job.pre:
        try:
            result = _run(command, env)
        except (OSError, subprocess.TimeoutExpired) as error:
            return failed(f"pre-command {Path(command[0]).name}: {error.__class__.__name__}")
        if result.returncode != 0:
            return failed(f"pre-command {Path(command[0]).name} exited {result.returncode}: {_redact(result.stderr, env)}")

    command = ["restic", "backup", "--json", "--tag", f"job={job.name}"]
    for pattern in job.exclude:
        command += ["--exclude", pattern]
    command += job.paths
    try:
        result = _run(command, env)
    except (OSError, subprocess.TimeoutExpired) as error:
        return failed(f"restic: {error.__class__.__name__}")
    if result.returncode != 0:
        return failed(f"restic exited {result.returncode}: {_redact(result.stderr, env)}")
    summary = _summary(result.stdout)
    size = summary.get("total_bytes_processed") if summary else None
    if not isinstance(size, int) or size < 0:
        return failed("restic reported no backup summary")
    completed = now()
    return Evidence(job.name, "SUCCESS", completed, size, True, completed + dt.timedelta(days=job.keep_daily))


def _iso(value: dt.datetime | None) -> str:
    if value is None:
        return ""
    return value.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def evidence_csv(rows: list[Evidence]) -> str:
    lines = [HEADER]
    for row in rows:
        size = "" if row.size_bytes is None else str(row.size_bytes)
        lines.append(f"{row.job},{row.result},{_iso(row.completed_at)},{size},{'yes' if row.encrypted else 'no'},{_iso(row.retention_until)}")
    return "\n".join(lines) + "\n"


def write_outbox(outbox: Path, rows: list[Evidence], now: dt.datetime) -> Path:
    """Writes under a dot-prefixed temporary name, then renames, so readers never see a partial file."""
    outbox.mkdir(parents=True, exist_ok=True)
    host = re.sub(r"[^A-Za-z0-9.-]", "-", socket.gethostname())[:64] or "host"
    final = outbox / f"{host}-{now.astimezone(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.csv"
    fd, temp = tempfile.mkstemp(prefix=".", suffix=".tmp", dir=outbox)
    with os.fdopen(fd, "w") as handle:
        handle.write(evidence_csv(rows))
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temp, 0o640)
    os.replace(temp, final)
    return final


def _log(event: str, **detail) -> None:
    print(json.dumps({"at": _iso(dt.datetime.now(dt.timezone.utc)), "event": event, **detail}, ensure_ascii=False), file=sys.stderr)


def backup(config: Config, outbox: Path, *, env: Mapping[str, str], now: Callable[[], dt.datetime]) -> int:
    rows = []
    for job in config.jobs:
        evidence = run_job(job, now=now, env=env)
        _log("backup.job", job=job.name, result=evidence.result, size_bytes=evidence.size_bytes, detail=evidence.detail or None)
        rows.append(evidence)
    write_outbox(outbox, rows, now())
    return 0 if all(r.result == "SUCCESS" for r in rows) else 1


def prune(config: Config, *, env: Mapping[str, str]) -> int:
    status = 0
    for job in config.jobs:
        command = [
            "restic", "forget", "--tag", f"job={job.name}",
            "--keep-daily", str(job.keep_daily), "--keep-weekly", str(job.keep_weekly),
            "--keep-monthly", str(job.keep_monthly), "--prune",
        ]
        result = _run(command, env)
        _log("prune.job", job=job.name, exit=result.returncode, detail=_redact(result.stderr, env) if result.returncode else None)
        status |= result.returncode != 0
    result = _run(["restic", "check", "--read-data-subset", config.check_subset], env)
    _log("check", exit=result.returncode, detail=_redact(result.stderr, env) if result.returncode else None)
    status |= result.returncode != 0
    return int(bool(status))


def main(argv: list[str] | None = None, *, env: Mapping[str, str] | None = None, now: Callable[[], dt.datetime] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Encrypted offsite backup to GDCC with restic (ADR 0009).")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("backup", help="run every job and write Backup Evidence to the outbox")
    run.add_argument("--config", required=True)
    run.add_argument("--outbox", required=True)
    maintenance = sub.add_parser("prune", help="apply retention and check a data sample (maintenance host only)")
    maintenance.add_argument("--config", required=True)
    args = parser.parse_args(argv)

    env = dict(os.environ if env is None else env)
    now = now or (lambda: dt.datetime.now(dt.timezone.utc))
    try:
        check_environment(env)
        config = load_config(args.config)
    except ConfigError as error:
        _log("config.error", message=str(error))
        return 2
    if args.command == "backup":
        return backup(config, Path(args.outbox), env=env, now=now)
    return prune(config, env=env)


if __name__ == "__main__":
    sys.exit(main())
