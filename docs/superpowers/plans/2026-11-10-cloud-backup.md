# Cloud Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload HOSxP daily backup files and the project's own systems to GDCC automatically and encrypted, prune the oldest unprotected backups when storage nears the quota, and show logs and a dashboard in the Portal.

**Architecture:** Python tools on a Backup Gateway and on each project host encrypt with `age` to a public key and upload through `rclone` to an S3-compatible GDCC bucket with a 7-day Object Lock, writing JSON-lines logs and a report object per run. A Capacity Pruner with its own credential deletes oldest-first under protections. The Portal worker pulls reports and usage with a read-only account into new tables and Backup Evidence; the Backup page shows the dashboard.

**Tech Stack:** Python 3 standard library (`unittest`, `tarfile`, `hashlib`, `subprocess`, `json`); `age` 1.x; `rclone` 1.6x (S3 backend); systemd timers; MinIO with Object Lock for end-to-end tests; Portal stack (Next.js 15, Prisma 6, MariaDB, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-10-cloud-backup-design.md` (decision: `docs/adr/0009-gdcc-cloud-backup-with-capacity-pruning.md`)

## Global Constraints

- Cloud: GDCC, bucket `project-backup`; Log Archive bucket `log-archive` is never touched by these tools.
- Nothing is uploaded unless it is an `age` stream; no plaintext copy of a HOSxP file is written anywhere by these tools.
- Object Lock compliance 7 days; protected minimums `hosxp-daily` 7, other jobs 3; pruning starts at 0.85 of quota, stops at 0.75, deletes at most 0.20 of usage per run; lifecycle backstop 365 days; reports older than 400 days are prunable.
- Only `capacity_pruner.py` calls a delete. The Portal client exposes no write or delete call.
- Report format `cloud-backup-report/v1`; log and report fields exactly as in the spec; times UTC ISO 8601 with `Z`; Portal renders Asia/Bangkok.
- Default schedules (Asia/Bangkok): `hosxp-daily` 02:00 with deadline 06:00, `wazuh-config` 01:00, `portal-config` 01:15, `log-relay-config` 01:30, `portal-db` every 6 h, `capacity-prune` 05:00, `gdcc-integrity` Sunday 06:00.
- Incident rules: `hosxp-daily` FAILED → P2; other job FAILED twice in a row → P3; `capacity_blocked` → P2; stale → P3. Usage older than 26 h shows "ไม่มีข้อมูลล่าสุด", never a number.
- No patient data, real names, hostnames, IP addresses, credentials or keys in code, tests, fixtures, logs, reports or examples. Tests use synthetic files only. Commit `*.example` files only.
- The Portal gains no run, restore or delete control. Installation, the Backup Gateway and bucket creation are production changes needing hospital approval; this plan prepares them.
- Runbooks Thai-first.

## Review Focus

- A HOSxP file still being written when the uploader starts must not be uploaded half-finished (size or mtime changes within 10 minutes → wait).
- The same HOSxP file seen again the next day (unchanged) must not be uploaded twice and must not count as today's new file.
- The pruner must never delete the only copy of the newest backup, even when usage is far over quota and every other object is locked.
- A GDCC listing that fails part-way must make the pruner delete nothing, not prune from a partial view.
- A report object with unexpected fields, a future time or a 13-digit number must be rejected by the Portal, not stored.

---

### Task 0: Hospital readiness record

**Files:**
- Create: `docs/operations/cloud-backup-readiness-record.md`

- [ ] **Step 1: Write the Thai record template** with columns `รายการ | ผล | หลักฐานอ้างอิง | ผู้ยืนยัน | วันที่` and one row per item in the spec's "Hospital decisions and confirmations". Gate sentence: Task 10 starts only when every row is filled; if GDCC lacks Object Lock, stop and revisit ADR 0009.
- [ ] **Step 2: Run the CI Markdown link check locally**; expect no broken links.
- [ ] **Step 3: Commit** `docs: add cloud backup readiness record`.

### Task 1: Shared library — config, naming, logging, reports

**Files:**
- Create: `infrastructure/backup/cloudbackup/__init__.py`, `config.py`, `naming.py`, `runlog.py`
- Create: `infrastructure/backup/config.example.json`
- Test: `infrastructure/backup/tests/test_config.py`, `test_naming.py`, `test_runlog.py`
- Test helper: `infrastructure/backup/tests/fakes.py` — writes fake `age` (prefixes `age-encryption.org/v1\n`), `rclone` (a temp dir as the remote; supports `rcat`, `cat`, `lsjson --recursive`, `deletefile`, version listing via a sidecar JSON with `retain_until`; can fail on demand) and `timedatectl` onto a temp `PATH`.

**Interfaces:**
- Produces:
  - `load_config(path: Path) -> Config`; `Config` fields: `recipient: str`, `remote: str`, `log_dir: Path`, `state_dir: Path`, `jobs: dict[str, JobConfig]`, `hosxp: HosxpConfig | None`, `prune: PruneConfig | None`; raises `ConfigError`.
  - `HosxpConfig(source_dir: Path, patterns: list[str], settle_minutes: int = 10, deadline: str = "06:00", bwlimit: str | None = None)`
  - `PruneConfig(quota_bytes: int, high_water: float = 0.85, target: float = 0.75, max_delete_fraction: float = 0.20, min_keep: dict[str, int])`
  - `JobConfig(name: str, interval_hours: int, collect: list[list[str]] = [], paths: list[str] = [], timeout_seconds: int = 1800)`
  - `safe_name(name: str) -> bool` (`^[A-Za-z0-9._-]{1,200}$` and no run of 13 digits)
  - `object_key(job: str, original: str, at: datetime) -> str` → `"<job>/<YYYY>/<MM>/<original>.<YYYYMMDDTHHMMSSZ>.age"`; `manifest_key(object_key: str) -> str` replaces `.age` with `.manifest.json`; `run_id(job: str, at: datetime) -> str` → `"<YYYYMMDDTHHMMSSZ>-<job>"`; `report_key(job: str, run_id: str, at: datetime) -> str` → `"_reports/<job>/<YYYY>/<MM>/<run_id>.json"`
  - `class RunLog(job, log_dir, clock)` with `event(event: str, **fields) -> None` (one JSON line) and `report(result: str, reason: str | None, objects: list[dict], deleted: list[dict] | None = None, usage: dict | None = None) -> dict` (the `cloud-backup-report/v1` document)
  - `ntp_synchronised() -> bool` (`timedatectl show -p NTPSynchronized --value` prints `yes`)

- [ ] **Step 1: Write failing tests**

```python
def test_object_key(self):
    at = datetime(2026, 11, 10, 19, 0, 2, tzinfo=timezone.utc)
    self.assertEqual(naming.object_key("hosxp-daily", "hosxp-20261111.sql.gz", at),
                     "hosxp-daily/2026/11/hosxp-20261111.sql.gz.20261110T190002Z.age")
def test_report_key(self):   # "_reports/hosxp-daily/2026/11/20261110T190000Z-hosxp-daily.json"
def test_safe_name_rejects_national_id_and_paths(self):  # "pt-1234567890123.sql", "../x", "a b" -> False
def test_recipient_must_be_public(self):  # "AGE-SECRET-KEY-1..." -> ConfigError; must match ^age1[0-9a-z]{58}$
def test_prune_thresholds_validated(self):  # target >= high_water, fraction > 1, quota <= 0 -> ConfigError
def test_example_config_loads(self):  # intervals and minimums equal Global Constraints
def test_runlog_line_fields(self):   # keys subset of at, job, run_id, event, object_key, size_bytes, duration_ms, result, reason
def test_report_shape(self):         # format "cloud-backup-report/v1"; usage and deleted omitted unless given
```

- [ ] **Step 2: Run** `python3 -m unittest discover -s infrastructure/backup/tests -v`; expect FAIL (package missing).
- [ ] **Step 3: Implement** the modules with the signatures above.
- [ ] **Step 4: Run tests**; expect PASS.
- [ ] **Step 5: Commit** `feat: add cloud backup config, naming and run logs`.

### Task 2: HOSxP Uploader

**Files:**
- Create: `infrastructure/backup/cloudbackup/upload.py`, `infrastructure/backup/hosxp_uploader.py`
- Test: `infrastructure/backup/tests/test_hosxp_uploader.py`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `upload_encrypted(src: BinaryIO, key: str, config: Config, runlog: RunLog, bwlimit: str | None = None) -> dict` returning `{"key", "size_bytes", "sha256", "encrypted": True}`; raises `UploadError`.
  - `run(config: Config, clock, sleep) -> dict` (the report); CLI `python3 hosxp_uploader.py --config <path>`; exit 0 SUCCESS, 1 FAILED, 2 refused (no NTP).

- [ ] **Step 1: Write failing tests** (synthetic random-byte files in a temp source dir)

```python
def test_uploads_new_complete_file_encrypted(self):     # one object + manifest; object starts with age header; report SUCCESS
def test_done_marker_counts_as_complete(self):
def test_waits_for_settling_file(self):                 # mtime 2 min ago -> not uploaded; deadline reached -> FAILED no_new_file
def test_skips_already_uploaded_file(self):             # second run, same name/size/mtime -> nothing uploaded, FAILED no_new_file
def test_source_unavailable(self):                      # missing dir -> FAILED source_unavailable, nothing uploaded
def test_retry_uses_new_key_then_fails(self):           # rclone fails 3 times -> 3 distinct keys, FAILED upload_failed
def test_rejects_unsafe_file_name(self):                # name with 13-digit run -> skipped, log event "unsafe_name"
def test_no_plaintext_written(self):                    # no file outside source dir contains the source bytes
def test_never_modifies_source(self):                   # source bytes and mtime unchanged
def test_report_kept_when_report_upload_fails(self):    # saved in state_dir/pending, sent on next run
def test_bwlimit_passed_to_rclone(self):
def test_refuses_without_ntp(self):                     # exit 2, no report
```

- [ ] **Step 2: Run tests**; expect FAIL.
- [ ] **Step 3: Implement.** `upload_encrypted`: source → `age -r` (pipe) → Python reads `age` stdout in 1 MiB chunks, updates SHA-256 and writes to `rclone rcat <remote>/<key>` stdin; then uploads the manifest. `run`: poll every 5 minutes until the deadline for complete files; retry backoff 30 s, 120 s, 480 s via injected `sleep`, new key per attempt. State file `state_dir/hosxp-uploaded.json` keyed by name, size and mtime, written only after success.
- [ ] **Step 4: Run tests**; expect PASS.
- [ ] **Step 5: Commit** `feat: upload HOSxP daily backup files to GDCC encrypted`.

### Task 3: Backup Agent for project systems

**Files:**
- Create: `infrastructure/backup/backup_agent.py`
- Test: `infrastructure/backup/tests/test_backup_agent.py`

**Interfaces:**
- Consumes: Task 1, `upload_encrypted` from Task 2.
- Produces: `run_job(config: Config, job: str, clock, sleep) -> dict` (report); CLI `python3 backup_agent.py --config <path> --job <name>`, exit codes as Task 2.

- [ ] **Step 1: Write failing tests**: success uploads `<job>/<YYYY>/<MM>/<job>.tar.gz.<ts>.age` with manifest and SUCCESS report; collect non-zero → FAILED `collect_failed`, nothing uploaded; collect timeout (1 s vs `sleep 5`) → FAILED `collect_timeout`; `age` fails → FAILED, temp dir (mode 0700) removed; upload retries as Task 2; refuses without NTP.
- [ ] **Step 2: Run tests**; expect FAIL.
- [ ] **Step 3: Implement**: collect into a 0700 temp dir, stream a gzip tar into `upload_encrypted`, remove the temp dir in `finally`.
- [ ] **Step 4: Run all backup tests**; expect PASS.
- [ ] **Step 5: Commit** `feat: back up project systems to GDCC`.

### Task 4: Capacity Pruner

**Files:**
- Create: `infrastructure/backup/capacity_pruner.py`
- Test: `infrastructure/backup/tests/test_capacity_pruner.py`

**Interfaces:**
- Consumes: Task 1.
- Produces: `Version(key: str, version_id: str, job: str, size_bytes: int, uploaded_at: datetime, retain_until: datetime | None, is_manifest: bool)`; `plan_deletions(versions: list[Version], prune: PruneConfig, now: datetime) -> tuple[list[Version], str]` (pure; outcome `no_action` | `pruned` | `capacity_blocked`); `run(config: Config, clock, dry_run: bool) -> dict`; CLI `python3 capacity_pruner.py --config <path> [--dry-run]`.

- [ ] **Step 1: Write failing tests for `plan_deletions`** (quota 1000 bytes)

```python
def test_below_high_water_no_action(self):          # usage 840 -> ([], "no_action")
def test_deletes_oldest_first_to_target(self):      # usage 900 -> oldest unlocked deleted until <= 750, "pruned"
def test_object_and_manifest_deleted_together(self):
def test_locked_versions_never_deleted(self):       # retain_until > now
def test_newest_min_keep_protected_per_job(self):   # hosxp-daily newest 7 kept even if unlocked and old
def test_delete_cap_twenty_percent(self):           # usage 1000 -> deletes <= 200 bytes, "capacity_blocked"
def test_blocked_when_everything_protected(self):   # ([], "capacity_blocked")
def test_old_reports_prunable_after_400_days(self):
```

- [ ] **Step 2: Write failing tests for `run`**: listing failure part-way → FAILED `gdcc_unreachable`, zero delete calls; `--dry-run` → report has planned deletions and `"dry_run": true`, zero delete calls; each deletion logs key, job, size, uploaded_at, age_days, reason `capacity`; report `usage` has before and after; only `project-backup` is listed.
- [ ] **Step 3: Run tests**; expect FAIL.
- [ ] **Step 4: Implement.** List with `rclone lsjson --recursive --versions --metadata` (retain-until from Object Lock metadata); delete one version with `rclone deletefile --s3-version-id <id>`. Usage counts all versions.
- [ ] **Step 5: Run tests**; expect PASS.
- [ ] **Step 6: Commit** `feat: prune oldest unprotected GDCC backups near quota`.

### Task 5: Integrity Check

**Files:**
- Create: `infrastructure/backup/integrity_check.py`
- Test: `infrastructure/backup/tests/test_integrity_check.py`

**Interfaces:**
- Produces: `check(config: Config, clock) -> dict` (report for job `gdcc-integrity`; `objects` lists each job with `ok` and `problem`); CLI exit 0 or 1.

- [ ] **Step 1: Write failing tests**: all newest objects match manifest SHA-256 and `age` header → SUCCESS; one flipped byte → FAILED naming the job; object without `age` header → FAILED; job with no object → FAILED `no_object`; newest object older than 2 × interval → FAILED `stale`.
- [ ] **Step 2: Run tests**; expect FAIL.
- [ ] **Step 3: Implement** with read-only `rclone lsjson` and `rclone cat`, hashing the stream without saving it.
- [ ] **Step 4: Run tests**; expect PASS.
- [ ] **Step 5: Commit** `feat: add weekly GDCC integrity check`.

### Task 6: Object Lock end-to-end test, credentials and CI

**Files:**
- Create: `infrastructure/backup/tests/test_minio_e2e.py`
- Create: `infrastructure/backup/policy.upload.example.json`, `policy.pruner.example.json`, `policy.readonly.example.json`, `lifecycle.example.json`
- Modify: `.github/workflows/ci.yml` (job `cloud-backup`)

- [ ] **Step 1: Write the failing test** (runs only with `BACKUP_E2E=1`): MinIO bucket with lock and compliance retention (1 minute via config override), three users from the policy examples. With real `age` and `rclone` assert: uploader succeeds; upload user cannot delete or list; pruner cannot delete a locked version; after the lock expires the pruner deletes oldest first and usage drops; read-only user cannot write or delete; integrity check passes.
- [ ] **Step 2: Run** `BACKUP_E2E=1 python3 -m unittest infrastructure/backup/tests/test_minio_e2e.py -v`; expect FAIL (policies missing).
- [ ] **Step 3: Write the policies** with the rights in the spec's credential table, and `lifecycle.example.json` (expire after 365 days, noncurrent versions 1 day after lock ends).
- [ ] **Step 4: Run the test**; expect PASS.
- [ ] **Step 5: Add CI job `cloud-backup`**: install `age` and `rclone`, run unit tests, run the e2e test against a MinIO service container. Push; expect green.
- [ ] **Step 6: Commit** `test: prove GDCC credentials and Object Lock limits`.

### Task 7: Portal cloud backup connector

**Files:**
- Modify: `portal/prisma/schema.prisma`; create migration `portal/prisma/migrations/<timestamp>_cloud_backup/migration.sql`
- Create: `portal/src/lib/backups/cloud/report.ts`, `client.ts`, `sync.ts`; `portal/src/lib/db/cloud-backup-store.ts`
- Modify: `portal/src/lib/config.ts` (GDCC endpoint, bucket, read-only key id and secret from env, quota bytes), `portal/src/lib/worker/cycles.ts`, `portal/src/worker.ts` (cycle every 15 min, only when configured), `portal/.env.example`
- Test: `portal/src/lib/backups/cloud/report.test.ts`, `sync.test.ts`, `portal/src/lib/db/cloud-backup-store.db.test.ts`

**Interfaces:**
- Produces:
  - Prisma models `CloudBackupRun`, `CloudBackupDeletion`, `CloudStorageSnapshot` with the fields in the spec's "Portal dashboard" section; `runId` unique.
  - `parseReport(json: unknown, now: Date): CloudBackupReport` (zod, strict; throws `CloudReportError`)
  - `interface CloudBackupSource { listReportKeys(after: string | null): Promise<string[]>; getReport(key: string): Promise<unknown> }` — S3 `ListObjectsV2` and `GetObject` signed with SigV4 over `node:https`; no other S3 call.
  - `syncCloudBackups(deps: { source: CloudBackupSource; store: CloudBackupStore; backups: BackupStore; incidents: IncidentService; connector: ConnectorStateStore; clock: () => Date }): Promise<{ imported: number; rejected: number }>`

- [ ] **Step 1: Write failing tests**

```ts
it("rejects a report with a future finished_at, unknown fields or a 13-digit number", ...)
it("stores runs, deletions and usage, and advances the checkpoint", ...)
it("writes Backup Evidence for a registered job as system:gdcc-backup", ...)  // SUCCESS -> SUCCESS, encrypted true
it("imports a run_id only once", ...)
it("opens P2 for hosxp-daily FAILED and for capacity_blocked", ...)
it("opens P3 when another job fails twice in a row", ...)
it("records lastError and changes nothing when GDCC is unreachable", ...)
it("source exposes only list and get", () => expect(Object.keys(source).sort()).toEqual(["getReport", "listReportKeys"]))
```

- [ ] **Step 2: Run** `cd portal && npm test -- cloud`; expect FAIL.
- [ ] **Step 3: Implement** schema and migration (`npx prisma migrate dev --name cloud_backup`), parser, client, store and sync. Evidence goes through the existing `BackupStore.addEvidence`; incidents through the existing incident service using the Global Constraints rules.
- [ ] **Step 4: Run** `npm test`, the DB test against MariaDB, and `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `feat: pull GDCC cloud backup reports into the Portal`.

### Task 8: Portal cloud backup dashboard

**Files:**
- Modify: `portal/src/app/(app)/backups/page.tsx`, `portal/src/lib/backups/service.ts`, the executive summary under `portal/src/lib/reporting/`
- Create: `portal/src/lib/backups/cloud/dashboard.ts`
- Test: `portal/src/lib/backups/cloud/dashboard.test.ts`, `portal/e2e/backups.spec.ts`

**Interfaces:**
- Consumes: Task 7 store.
- Produces: `cloudBackupDashboard(actor: Principal): Promise<CloudDashboard>` requiring `evidence.read`; `CloudDashboard = { usage: { usedBytes: number; quotaBytes: number; percent: number; level: "normal" | "warning" | "critical"; takenAt: Date } | { stale: true; takenAt: Date | null }; trend: { day: string; usedBytes: number }[]; runs: RunRow[]; deletions: DeletionRow[] }`; executive summary adds `cloudUsagePercent: number | null`.

- [ ] **Step 1: Write failing tests**: level thresholds (<75 normal, 75–85 warning, >85 critical); snapshot 27 h old → `stale`; trend has one point per Bangkok day for 30 days; runs and deletions capped at 50 newest; Executive Viewer is forbidden the dashboard and sees only the percentage in the executive summary; Playwright: Security Operator sees the usage card, upload log and pruning log in Thai, and `page.getByRole("button", { name: /ลบ|กู้คืน|สำรองตอนนี้/ })` has count 0.
- [ ] **Step 2: Run tests**; expect FAIL.
- [ ] **Step 3: Implement** the service function and the "Cloud Backup (GDCC)" section; trend as an inline SVG line chart using existing styles.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e -- backups`; expect PASS.
- [ ] **Step 5: Commit** `feat: show GDCC cloud backup dashboard and logs`.

### Task 9: Deployment files, runbooks and glossary

**Files:**
- Create: `infrastructure/backup/README.md`, `hosxp-uploader.service.example`, `hosxp-uploader.timer.example`, `backup-agent@.service.example`, `backup-agent@.timer.example`, `capacity-pruner.service.example`, `capacity-pruner.timer.example`, `integrity-check.service.example`, `integrity-check.timer.example`, `rclone.conf.example`, `logrotate.example`
- Create: `docs/operations/cloud-backup-runbook.md`, `docs/operations/cloud-backup-restore-test-record.md`
- Modify: `docs/operations/backup-evidence-runbook.md`, `docs/operations/siem-backup-recovery-runbook.md`, `docs/operations/log-archive-runbook.md`, `CONTEXT.md`
- Test: `infrastructure/backup/tests/test_deploy_examples.py`

- [ ] **Step 1: Write failing tests**: timers use `OnCalendar` with `Asia/Bangkok` and the Global Constraints times plus `Persistent=true`; services run as dedicated users (`cloud-backup`, `cloud-pruner`) with `ProtectSystem=strict`, `PrivateTmp=yes`, `NoNewPrivileges=yes`, and the uploader lists the HOSxP folder in `ReadOnlyPaths=`; only the pruner unit references the pruner credential file; no file under `infrastructure/backup/` matches an IPv4 address or `AGE-SECRET-KEY-`.
- [ ] **Step 2: Run tests**; expect FAIL.
- [ ] **Step 3: Write the examples and Thai runbooks**: installation per host, read-only mount of the HOSxP folder, key ceremony (generate the identity offline, store in the Secrets Vault, seal the offline copy, distribute only the recipient), changing upload time and bandwidth, reading logs and the dashboard, response per incident rule, one week of pruner dry-run before enabling, restore steps, quarterly restore tests with the record template. Point the Wazuh runbook's GDCC rows and the evidence runbook at the new runbook (evidence for cloud jobs is now automatic; CSV import stays for other systems). Glossary terms: Backup Gateway, HOSxP Uploader, Capacity Pruner, Capacity Retention Policy, Integrity Check, Restore Test Host.
- [ ] **Step 4: Run tests and the Markdown link check**; expect PASS.
- [ ] **Step 5: Commit** `docs: add cloud backup runbooks and deployment examples`.

### Task 10: Rehearsal (hospital-approved, outside git)

Only after the readiness record is complete. Install on the Backup Gateway and hosts; run the pruner in dry-run for one week and review its plan; run every job once by hand; confirm the Portal dashboard shows each job healthy and the usage card filled; restore one HOSxP file (on a HOSxP test server, by the HOSxP administrator), `portal-db` and `wazuh-config` from GDCC under dual control and record the results. Gate: all three restores pass, and the Wazuh and Portal rebuild finishes within 24 hours.
