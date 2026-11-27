# GDCC Offsite Backup and Portal Database Replica Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypted daily backups of the security stack to GDCC, a read-only Portal MariaDB replica on a GDCC VM, and Portal visibility of both (automatic Backup Evidence import and replica health).

**Architecture:** A Python standard-library wrapper around restic runs on each host and writes Backup Evidence CSV into an outbox that is delivered to a Portal inbox. The Portal worker imports the inbox as `system:gdcc-backup`, and checks the replica with a monitor-only account, storing the latest check and raising a P3 incident after two bad checks. MariaDB replication is configured from `*.example` files and a Thai runbook.

**Tech Stack:** Python 3.11+ (`tomllib`, `unittest`), restic, MariaDB 10.11 GTID replication, systemd timers, Portal (Next.js, Prisma, Vitest).

**Spec:** `docs/superpowers/specs/2026-11-26-gdcc-offsite-backup-design.md`, ADR 0009.

## Global Constraints

- No credentials, endpoints, bucket names or real IPs in git; `*.example` files only (documentation ranges 192.0.2.0/24, 198.51.100.0/24).
- Evidence CSV format is exactly `job,result,completed_at,size_bytes,encrypted,retention_until`, times UTC ISO 8601.
- Job names match `^[A-Za-z0-9._-]{1,128}$` (the Portal rule).
- `RESTIC_PASSWORD` in the environment is refused; `RESTIC_PASSWORD_FILE` is required.
- Replica states: `healthy` (threads running, lag ≤ 300 s), `lagging`, `broken`, `unavailable`; page shows stale when the check is older than 15 minutes.
- Replica incident: P3, category `replica_health`, source `portal-db-replica`, after 2 consecutive bad checks.
- No backup, restore, promote or delete control in the Portal.

## Review Focus

- restic prints a non-JSON line or no summary: job must record FAILED, not SUCCESS with a size of 0.
- A pre-command (database dump) fails: restic must not run and the job records FAILED.
- An evidence file arrives half-written: dotfiles (rsync temp files) are skipped; the wrapper writes via temp name then rename.
- The replica monitor URL is wrong or the host is down: state `unavailable`, error message without the URL or password.
- `Seconds_Behind_Master` is NULL while threads run: state `lagging` (unknown lag is not healthy).

---

### Task 1: restic wrapper `gdcc_backup.py`

**Files:**
- Create: `infrastructure/gdcc-backup/gdcc_backup.py`, `jobs.example.toml`, `gdcc-backup.env.example`, `dump-portal-db.sh`, `systemd/gdcc-backup.service.example`, `systemd/gdcc-backup.timer.example`, `README.md`
- Test: `infrastructure/gdcc-backup/tests/test_gdcc_backup.py` (fake `restic` on `PATH`)
- Modify: `.github/workflows/ci.yml` (new job `gdcc-backup`)

**Interfaces:**
- Produces: CLI `gdcc_backup.py backup --config FILE --outbox DIR` and `gdcc_backup.py prune --config FILE`; `load_config(path) -> Config`; `run_job(job, now) -> Evidence`; `evidence_csv(list[Evidence]) -> str`.

- [ ] Step 1: Tests: config validation (bad name, relative path, missing retention), refuses `RESTIC_PASSWORD`, success writes `SUCCESS` with `total_bytes_processed` and `retention_until = completed + keep_daily days`, restic failure → `FAILED`, pre-command failure → `FAILED` and restic not called, missing summary → `FAILED`, outbox written atomically with no leftover temp file, exit code 1 when any job fails, `prune` calls `forget --tag job=<name> --keep-daily/--keep-weekly/--keep-monthly --prune` then `check --read-data-subset`.
- [ ] Step 2: Run `python3 -m unittest discover -s infrastructure/gdcc-backup/tests -v`, expect import failure.
- [ ] Step 3: Implement.
- [ ] Step 4: Re-run, expect PASS.
- [ ] Step 5: Commit `feat: add GDCC restic backup wrapper with Backup Evidence output`.

### Task 2: Portal evidence inbox import

**Files:**
- Modify: `portal/src/lib/backups/service.ts` (add `importSystemReport(csv, source, correlationId)`; share parsing with `importBackupReport`)
- Create: `portal/src/lib/backups/inbox.ts`, test `inbox.test.ts`
- Modify: `portal/src/lib/config.ts` (`BACKUP_EVIDENCE_INBOX`), `portal/src/lib/worker/cycles.ts`, `portal/src/worker.ts`, `portal/.env.example`

**Interfaces:**
- Produces: `importSystemReport(csv: string, source: string, correlationId: string): Promise<{ imported: number; rejected: {line:number; reason:string}[] }>` (recorded by `system:gdcc-backup`, audit action `backup.report_imported` with `source`); `processEvidenceInbox(dir: string, importer, correlationId): Promise<{ files: number; imported: number; rejected: number; oversized: number }>`; config `backupEvidenceInbox?: string`; worker dep `importBackupInbox?: (correlationId) => Promise<Record<string, unknown>>`.

- [ ] Step 1: Tests: system import records evidence with `recordedById` `system:gdcc-backup` and audit actor label; unknown job lines rejected; inbox imports `*.csv`, moves to `processed/`, skips dotfiles and non-csv, moves files over 64 KB to `rejected/`; config rejects a relative inbox path.
- [ ] Step 2: Run `npx vitest run src/lib/backups src/lib/config.test.ts`, expect FAIL.
- [ ] Step 3: Implement; worker runs the cycle every 5 minutes only when configured.
- [ ] Step 4: Re-run, expect PASS; `npm run typecheck`.
- [ ] Step 5: Commit `feat: import Backup Evidence from the GDCC backup inbox`.

### Task 3: Portal replica health

**Files:**
- Create: `portal/src/lib/replica/status.ts` (+ test), `portal/src/lib/replica/service.ts` (+ test), `portal/src/lib/db/replica-store.ts` (+ db test)
- Create: migration `portal/prisma/migrations/20261126100000_replica_check/migration.sql`; Modify: `schema.prisma`
- Modify: config (`PORTAL_REPLICA_MONITOR_URL`), worker, `portal/src/app/(app)/backups/page.tsx`

**Interfaces:**
- Produces: `evaluateReplicaStatus(row: Record<string, unknown> | null): { state: ReplicaState; lagSeconds: number | null; ioRunning: boolean; sqlRunning: boolean; error: string | null }`; `replicaView(check: ReplicaCheck | null, configured: boolean, now: Date)` returning a display state including `stale` and `not_configured`; `createReplicaMonitor({ fetchStatus, store, clock })` with `check(): Promise<{ check: ReplicaCheck; finding: Finding | null }>`.

- [ ] Step 1: Tests: both threads `Yes` and lag 10 → healthy; lag 301 → lagging; lag NULL with threads running → lagging; IO `No` or `Connecting` → broken with error; empty result → unavailable ("not a replica"); fetch throws → unavailable with sanitized message; consecutive failures counted and reset on healthy; finding only on the second bad check; view is `stale` after 15 minutes and `not_configured` without a URL.
- [ ] Step 2: Run, expect FAIL.
- [ ] Step 3: Implement; Prisma client for the monitor uses `datasourceUrl` and `$queryRawUnsafe("SHOW REPLICA STATUS")`.
- [ ] Step 4: Re-run unit and DB tests, typecheck, build.
- [ ] Step 5: Commit `feat: monitor the GDCC Portal database replica`.

### Task 4: Replica configuration and runbooks

**Files:**
- Create: `infrastructure/gdcc-replica/primary.cnf.example`, `replica.cnf.example`, `setup-replica.sql.example`, `README.md`, tests `infrastructure/gdcc-replica/tests/test_replica_config.py` (checks required settings exist and no non-documentation IPs)
- Create: `docs/operations/gdcc-backup-and-replica-runbook.md` (Thai)
- Modify: `CONTEXT.md`, `README.md`, `docs/operations/siem-backup-recovery-runbook.md`, `docs/operations/backup-evidence-runbook.md`, design spec component table, roadmap, CI.

- [ ] Step 1: Config tests (primary has `log_bin`, `binlog_format = ROW`, `gtid_strict_mode`, `sync_binlog = 1`; replica has `read_only = ON`, `relay_log_recovery = ON`; SQL uses `REQUIRE SSL`, `MASTER_SSL_VERIFY_SERVER_CERT=1`, `MASTER_USE_GTID=slave_pos`).
- [ ] Step 2: Run, expect FAIL.
- [ ] Step 3: Write the files and runbook (first-day GDCC hardening including changing the root password, setup, evidence delivery, monitoring, restore drill, replica promotion with approval).
- [ ] Step 4: Run all Python test suites and the Markdown link check locally.
- [ ] Step 5: Commit `docs: add GDCC backup and replica runbook and configuration`.
