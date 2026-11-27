# Cloud Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload HOSxP daily backup files and the project's own systems to a dedicated GDCC Backup VM automatically and encrypted, prune the oldest unprotected backups on the VM when its disk nears the limit, and show logs and a dashboard in the Portal.

**Architecture:** Python clients on a Backup Gateway and on each project host encrypt with `age` to a public key and push with `rsync` over SSH into an upload-only drop zone (`rrsync -wo`). Root services on the Backup VM seal uploads into a read-only, immutable store, prune by disk usage under protections, verify objects, and write a report per run. The Portal worker pulls only the reports with a read-only key into new tables and Backup Evidence; the Backup page shows the dashboard.

**Tech Stack:** Python 3 standard library (`unittest`, `tarfile`, `hashlib`, `subprocess`, `json`, `os.statvfs`); `age` 1.x; `rsync` 3.2+ with `rrsync`; OpenSSH; systemd timers; Rocky Linux 9 or AlmaLinux 9 on the VM; Portal stack (Next.js 15, Prisma 6, MariaDB, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-10-cloud-backup-design.md` (decision: `docs/adr/0009-gdcc-cloud-backup-with-capacity-pruning.md`)

## Global Constraints

- Target: a dedicated GDCC Backup VM; never the existing GDCC restore server. Paths: `/srv/backup/incoming/<job>/`, `/srv/backup/store/<job>/<YYYY>/<MM>/`, `/srv/backup/store/_reports/<job>/<YYYY>/<MM>/`, `/srv/backup/quarantine/`.
- Only `age` files are uploaded; the plaintext of a HOSxP file is never copied by these tools.
- Upload keys: `from="<hospital-address>",restrict,command="rrsync -wo /srv/backup/incoming/<job>"`. Portal key: `rrsync -ro /srv/backup/store/_reports`. VM firewall: TCP 22 from the hospital address only; password login off; no root SSH login.
- Sealed objects: owner `root`, mode `0440`, `chattr +i`. Only `vm/capacity_pruner.py` deletes, and only on the VM.
- Pruning: start when used + `reserve_bytes` ≥ 0.75 of disk, stop at 0.65; never objects younger than 7 days or among the newest `min_keep` good objects (`hosxp-daily` 7, others 3); anomalous objects do not count toward `min_keep`; at most 0.20 of used bytes per run; 365-day backstop; reports prunable after 400 days.
- Report format `cloud-backup-report/v1`; log and report fields exactly as in the spec; times UTC ISO 8601 with `Z`; Portal renders Asia/Bangkok.
- Default schedules (Asia/Bangkok): `hosxp-daily` 04:30, deadline 07:00, bandwidth `07:30,20M`; `wazuh-config` 01:00; `portal-config` 01:15; `log-relay-config` 01:30; `portal-db` every 6 h; `capacity-prune` 04:15; `seal` every 5 min; `vm-integrity` Sunday 06:00.
- Incident rules: `hosxp-daily` FAILED (including `size_anomaly`) → P2; `checksum_mismatch` → P2; `capacity_blocked` → P2; other job FAILED twice in a row → P3; stale → P3. Usage levels: normal < 65%, warning 65–75%, critical > 75%; snapshot older than 26 h shows "ไม่มีข้อมูลล่าสุด", never a number.
- No patient data, real names, hostnames, IP addresses, keys or credentials in code, tests, fixtures, logs, reports or examples. Tests use synthetic files only. Commit `*.example` files only.
- The Portal gains no run, restore or delete control. The Backup VM, the Backup Gateway and installation are production changes needing hospital approval; this plan prepares them.
- Runbooks Thai-first.

## Review Focus

- A HOSxP file still being written must not be uploaded half-finished (size or mtime changed within 10 minutes → wait).
- The same HOSxP file seen again the next day must not be uploaded twice or count as today's new file.
- Seven near-empty HOSxP ZIPs in a row must not let the pruner delete the last good backups.
- An upload that arrives without its manifest, or with a wrong checksum, must never be sealed as good.
- A report with unexpected fields, a future time or a 13-digit number must be rejected by the Portal, not stored.

---

### Task 0: Hospital readiness record

**Files:**
- Create: `docs/operations/cloud-backup-readiness-record.md`

- [ ] **Step 1: Write the Thai record template** with columns `รายการ | ผล | หลักฐานอ้างอิง | ผู้ยืนยัน | วันที่` and one row per item in the spec's "Hospital decisions and confirmations". Gate sentence: Task 10 starts only when every row is filled and the Backup VM exists with only SSH open from the hospital address.
- [ ] **Step 2: Run the CI Markdown link check locally**; expect no broken links.
- [ ] **Step 3: Commit** `docs: add cloud backup readiness record`.

### Task 1: Shared client library — config, naming, logs, reports, transport

**Files:**
- Create: `infrastructure/backup/cloudbackup/__init__.py`, `config.py`, `naming.py`, `runlog.py`, `transport.py`
- Create: `infrastructure/backup/config.example.json`
- Test: `infrastructure/backup/tests/test_config.py`, `test_naming.py`, `test_runlog.py`, `test_transport.py`
- Test helper: `infrastructure/backup/tests/fakes.py` — writes fake `age` (prefixes `age-encryption.org/v1\n`), `rsync` (copies into a temp "remote" dir; can fail on demand; records arguments) and `timedatectl` onto a temp `PATH`.

**Interfaces:**
- Produces:
  - `load_config(path: Path) -> Config`; fields `recipient: str`, `target: str` (`user@host`), `ssh_key: Path`, `staging_dir: Path`, `log_dir: Path`, `state_dir: Path`, `jobs: dict[str, JobConfig]`, `hosxp: HosxpConfig | None`; raises `ConfigError`.
  - `JobConfig(name: str, interval_hours: int, collect: list[list[str]] = [], paths: list[str] = [], timeout_seconds: int = 1800)`
  - `HosxpConfig(source_dir: Path, backup_pattern: str = "MySQL_backup_*.ZIP", log_pattern: str = "MySQL_backup_*_log.txt", settle_minutes: int = 10, deadline: str = "07:00", anomaly_ratio: float = 0.5, bwlimit: str | None = "07:30,20M")`
  - `safe_name(name: str) -> bool` (`^[A-Za-z0-9._-]{1,200}$` and no `(?<!\d)\d{13}(?!\d)`)
  - `object_name(original: str, at: datetime) -> str` → `"<original>.<YYYYMMDDTHHMMSSZ>.age"`; `manifest_name(object_name) -> str` (`.age` → `.manifest.json`); `run_id(job, at) -> str` → `"<YYYYMMDDTHHMMSSZ>-<job>"`
  - `class RunLog(job, log_dir, clock)` with `event(event: str, **fields) -> None` and `report(result, reason, objects, deleted=None, usage=None) -> dict`
  - `encrypt_to_staging(src: BinaryIO, staging: Path, recipient: str) -> tuple[Path, int, str]` (path, size, sha256)
  - `push(local: Path, job_dir: str, config: Config, bwlimit: str | None, sleep) -> None` — `rsync --partial-dir=.partial -e "ssh -i <key> -o BatchMode=yes"`; 3 attempts (30 s, 120 s, 480 s); raises `UploadError`
  - `ntp_synchronised() -> bool`

- [ ] **Step 1: Write failing tests**

```python
def test_object_name(self):
    at = datetime(2026, 11, 10, 21, 30, 2, tzinfo=timezone.utc)
    self.assertEqual(naming.object_name("MySQL_backup_db-host_00000_20261111000104.ZIP", at),
                     "MySQL_backup_db-host_00000_20261111000104.ZIP.20261110T213002Z.age")
def test_safe_name_rejects_national_id_and_paths(self):  # "pt-1234567890123.sql", "../x", "a b" -> False
def test_safe_name_allows_hosxp_timestamp(self):        # 14-digit timestamp -> True
def test_recipient_must_be_public(self):                 # "AGE-SECRET-KEY-1..." -> ConfigError; ^age1[0-9a-z]{58}$
def test_example_config_loads(self):                     # intervals equal Global Constraints
def test_runlog_line_fields(self):                       # keys subset of the spec's log fields
def test_report_shape(self):                             # format "cloud-backup-report/v1"
def test_encrypt_to_staging_hashes_ciphertext(self):     # sha256 equals hash of staged file; starts with age header
def test_push_retries_and_resumes(self):                 # fake rsync fails twice then succeeds; --partial-dir passed each time
def test_push_never_uses_delete_flags(self):             # no --delete*, --remove-source-files in recorded args
```

- [ ] **Step 2: Run** `python3 -m unittest discover -s infrastructure/backup/tests -v`; expect FAIL.
- [ ] **Step 3: Implement** the modules.
- [ ] **Step 4: Run tests**; expect PASS.
- [ ] **Step 5: Commit** `feat: add cloud backup client library`.

### Task 2: HOSxP Uploader

**Files:**
- Create: `infrastructure/backup/hosxp_uploader.py`
- Test: `infrastructure/backup/tests/test_hosxp_uploader.py`

**Interfaces:**
- Consumes: Task 1.
- Produces: `run(config: Config, clock, sleep) -> dict` (report); CLI `python3 hosxp_uploader.py --config <path>`; exit 0 SUCCESS, 1 FAILED, 2 refused (no NTP).

- [ ] **Step 1: Write failing tests** (synthetic random-byte files)

```python
def test_uploads_zip_and_log_encrypted(self):           # object + manifest per file in remote incoming/hosxp-daily/; SUCCESS
def test_manifest_fields(self):                          # original_name, original_size, size_bytes, sha256, uploaded_at, recipient_fingerprint, anomaly
def test_done_marker_counts_as_complete(self):
def test_waits_for_settling_file(self):                  # mtime 2 min ago -> wait; deadline -> FAILED no_new_file
def test_log_alone_is_not_a_new_backup(self):
def test_skips_already_uploaded_file(self):
def test_small_zip_is_size_anomaly(self):                # last 7 ~1 MB, new 50 KB -> uploaded, anomaly true, FAILED size_anomaly
def test_source_unavailable(self):
def test_staging_full(self):                             # free space < source size -> FAILED staging_full, nothing pushed
def test_upload_failed_after_retries(self):
def test_rejects_unsafe_file_name(self):
def test_no_plaintext_copy(self):                        # no file outside the source dir contains the source bytes
def test_never_modifies_source(self):
def test_staging_removed_after_success_kept_after_failure(self):
def test_report_pushed_to_incoming_reports(self):
def test_refuses_without_ntp(self):
```

- [ ] **Step 2: Run tests**; expect FAIL.
- [ ] **Step 3: Implement.** Poll every 5 minutes until the deadline; state file `state_dir/hosxp-uploaded.json` keyed by name, size and mtime, written only after a successful push; median of the last 7 sizes from the state file.
- [ ] **Step 4: Run tests**; expect PASS.
- [ ] **Step 5: Commit** `feat: upload HOSxP daily backup files encrypted to the GDCC Backup VM`.

### Task 3: Backup Agent for project systems

**Files:**
- Create: `infrastructure/backup/backup_agent.py`
- Test: `infrastructure/backup/tests/test_backup_agent.py`

**Interfaces:**
- Consumes: Task 1.
- Produces: `run_job(config: Config, job: str, clock, sleep) -> dict`; CLI `python3 backup_agent.py --config <path> --job <name>`, exit codes as Task 2.

- [ ] **Step 1: Write failing tests**: success pushes `<job>.tar.gz.<ts>.age` with manifest and SUCCESS report; collect non-zero → FAILED `collect_failed`, nothing pushed; timeout (1 s vs `sleep 5`) → FAILED `collect_timeout`; `age` fails → FAILED, 0700 temp dir removed; refuses without NTP.
- [ ] **Step 2: Run tests**; expect FAIL.
- [ ] **Step 3: Implement**: collect into a 0700 temp dir, stream a gzip tar into `encrypt_to_staging`, `push`, remove temp and staging.
- [ ] **Step 4: Run all backup tests**; expect PASS.
- [ ] **Step 5: Commit** `feat: back up project systems to the GDCC Backup VM`.

### Task 4: Backup VM sealing and integrity

**Files:**
- Create: `infrastructure/backup/vm/seal.py`, `infrastructure/backup/vm/vm_integrity.py`, `infrastructure/backup/vm/common.py`
- Test: `infrastructure/backup/tests/test_vm_seal.py`, `test_vm_integrity.py`

**Interfaces:**
- Produces: `seal_once(root: Path, clock, immutable: Callable[[Path, bool], None]) -> list[dict]` (one report per job that had uploads); `check(root: Path, jobs: dict[str, int], clock) -> dict` (report for job `vm-integrity`; `jobs` maps job → interval hours); `immutable` defaults to running `chattr ±i` and is faked in tests.

- [ ] **Step 1: Write failing tests**: complete object + manifest with matching SHA-256 → moved to `store/<job>/<YYYY>/<MM>/`, mode 0440, `immutable(path, True)` called for both; object without manifest → left in `incoming/`; size changed within 2 minutes → left; wrong SHA-256 or missing `age` header → moved to `quarantine/`, report `FAILED checksum_mismatch`; client reports in `incoming/_reports/` → sealed into `store/_reports/`; `.partial` dirs ignored. Integrity: all newest objects match → SUCCESS; flipped byte → FAILED naming the job; job with no object → FAILED `no_object`; newest older than 2 × interval → FAILED `stale`.
- [ ] **Step 2: Run tests**; expect FAIL.
- [ ] **Step 3: Implement** with `os.replace` within the same filesystem and `os.chmod`.
- [ ] **Step 4: Run tests**; expect PASS.
- [ ] **Step 5: Commit** `feat: seal and verify uploads on the GDCC Backup VM`.

### Task 5: Capacity Pruner on the Backup VM

**Files:**
- Create: `infrastructure/backup/vm/capacity_pruner.py`
- Test: `infrastructure/backup/tests/test_vm_pruner.py`

**Interfaces:**
- Produces: `StoredObject(path: Path, job: str, size_bytes: int, uploaded_at: datetime, anomaly: bool)`; `plan_deletions(objects: list[StoredObject], used: int, capacity: int, policy: PrunePolicy, now: datetime) -> tuple[list[StoredObject], str]` (pure; `no_action` | `pruned` | `capacity_blocked`); `PrunePolicy(high_water=0.75, target=0.65, max_delete_fraction=0.20, min_age_days=7, min_keep={"hosxp-daily": 7}, default_keep=3, reserve_bytes: int | None = None, backstop_days=365, report_days=400)`; `run(root: Path, policy, clock, dry_run: bool, immutable) -> dict`; CLI `python3 capacity_pruner.py --root /srv/backup [--dry-run]`.

- [ ] **Step 1: Write failing tests for `plan_deletions`** (capacity 1000)

```python
def test_below_high_water_no_action(self):           # used 740, reserve 0 -> ([], "no_action")
def test_deletes_oldest_first_to_target(self):       # used 800 -> oldest deleted until <= 650, "pruned"
def test_reserve_counts_toward_usage(self):          # used 700 + reserve 100 -> prunes until used <= 550
def test_young_objects_never_deleted(self):          # uploaded 6 days ago
def test_newest_min_keep_protected(self):            # hosxp-daily newest 7 good kept
def test_anomalies_do_not_count_toward_min_keep(self):  # 7 newest anomalous + 7 good older -> the 7 good kept
def test_delete_cap_twenty_percent(self):            # used 1000 -> deletes <= 200, "capacity_blocked"
def test_blocked_when_everything_protected(self):
def test_backstop_365_days(self):                    # below high water, 366-day-old unprotected object deleted
def test_old_reports_prunable_after_400_days(self):
```

- [ ] **Step 2: Write failing tests for `run`**: deletes object and manifest together after `immutable(path, False)`; `--dry-run` deletes nothing and reports `"dry_run": true`; report has `usage` before and after and a `deleted` entry per object with reason `capacity`; never touches `incoming/` or `quarantine/`.
- [ ] **Step 3: Run tests**; expect FAIL.
- [ ] **Step 4: Implement**; usage from `os.statvfs(root)`; manifests give `anomaly` and `uploaded_at`.
- [ ] **Step 5: Run tests**; expect PASS.
- [ ] **Step 6: Commit** `feat: prune oldest unprotected backups on the GDCC Backup VM`.

### Task 6: SSH access end-to-end test and CI

**Files:**
- Create: `infrastructure/backup/tests/test_ssh_e2e.py`, `infrastructure/backup/tests/sshd/Dockerfile`, `infrastructure/backup/vm/authorized_keys.example`, `infrastructure/backup/vm/sshd_config.example`, `infrastructure/backup/vm/firewalld.example.sh`
- Modify: `.github/workflows/ci.yml` (job `cloud-backup`)

- [ ] **Step 1: Write the failing test** (runs only with `BACKUP_E2E=1`): build a Rocky 9 container with `openssh-server`, `rsync` and `rrsync`, users and `authorized_keys` from the examples with a throwaway key. Assert with real `age` and `rsync`: uploader pushes into `incoming/hosxp-daily/`; with the upload key, listing `store/`, reading any file, writing outside its job dir, `--delete` and opening a shell all fail; `seal_once` seals; with the Portal key, `rsync` copies `store/_reports/` and fails on `store/hosxp-daily/` and on any write.
- [ ] **Step 2: Run** `BACKUP_E2E=1 python3 -m unittest infrastructure/backup/tests/test_ssh_e2e.py -v`; expect FAIL (examples missing).
- [ ] **Step 3: Write the examples**: `authorized_keys.example` with the `from=…,restrict,command="rrsync …"` lines using placeholders; `sshd_config.example` with `PasswordAuthentication no`, `PermitRootLogin no`, `AllowUsers`; `firewalld.example.sh` that allows SSH only from a placeholder source and removes every other service.
- [ ] **Step 4: Run the test**; expect PASS.
- [ ] **Step 5: Add CI job `cloud-backup`** on `ubuntu-24.04`: install `age` and `rsync`, run unit tests, run the e2e test with `BACKUP_E2E=1`. Push; expect green.
- [ ] **Step 6: Commit** `test: prove upload keys cannot read or delete on the Backup VM`.

### Task 7: Portal cloud backup connector

**Files:**
- Modify: `portal/prisma/schema.prisma`; create migration `portal/prisma/migrations/<timestamp>_cloud_backup/migration.sql`
- Create: `portal/src/lib/backups/cloud/report.ts`, `source.ts`, `sync.ts`; `portal/src/lib/db/cloud-backup-store.ts`
- Modify: `portal/src/lib/config.ts` (Backup VM target, key path, known-hosts path, local cache dir), `portal/src/lib/worker/cycles.ts`, `portal/src/worker.ts` (cycle every 15 min, only when configured), `portal/.env.example`
- Test: `portal/src/lib/backups/cloud/report.test.ts`, `sync.test.ts`, `portal/src/lib/db/cloud-backup-store.db.test.ts`

**Interfaces:**
- Produces:
  - Prisma models `CloudBackupRun`, `CloudBackupDeletion`, `CloudStorageSnapshot` with the fields in the spec's "Portal dashboard" section; `runId` unique.
  - `parseReport(json: unknown, now: Date): CloudBackupReport` (zod, strict; throws `CloudReportError`)
  - `interface CloudReportSource { fetchNewReports(): Promise<{ path: string; json: unknown }[]> }` — runs `rsync -e "ssh -i <key> -o BatchMode=yes -o UserKnownHostsFile=<path>"` from `store/_reports/` into the cache with `execFile` (no shell), returns files not yet imported; no other remote command exists.
  - `syncCloudBackups(deps: { source: CloudReportSource; store: CloudBackupStore; backups: BackupStore; incidents: IncidentService; connector: ConnectorStateStore; clock: () => Date }): Promise<{ imported: number; rejected: number }>`

- [ ] **Step 1: Write failing tests**

```ts
it("rejects a report with a future finished_at, unknown fields or a 13-digit number", ...)
it("stores runs, deletions and usage, and records the import", ...)
it("writes Backup Evidence for a registered job as system:gdcc-backup", ...)
it("imports a run_id only once", ...)
it("opens P2 for hosxp-daily FAILED, size_anomaly, checksum_mismatch and capacity_blocked", ...)
it("opens P3 when another job fails twice in a row", ...)
it("records lastError and changes nothing when the VM is unreachable", ...)
it("source exposes only fetchNewReports", () => expect(Object.keys(source)).toEqual(["fetchNewReports"]))
```

- [ ] **Step 2: Run** `cd portal && npm test -- cloud`; expect FAIL.
- [ ] **Step 3: Implement** schema and migration (`npx prisma migrate dev --name cloud_backup`), parser, source, store and sync. Evidence through the existing `BackupStore.addEvidence`; incidents through the existing incident service.
- [ ] **Step 4: Run** `npm test`, the DB test against MariaDB, and `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `feat: pull GDCC Backup VM reports into the Portal`.

### Task 8: Portal cloud backup dashboard

**Files:**
- Modify: `portal/src/app/(app)/backups/page.tsx`, `portal/src/lib/backups/service.ts`, the executive summary under `portal/src/lib/reporting/`
- Create: `portal/src/lib/backups/cloud/dashboard.ts`
- Test: `portal/src/lib/backups/cloud/dashboard.test.ts`, `portal/e2e/backups.spec.ts`

**Interfaces:**
- Consumes: Task 7 store.
- Produces: `cloudBackupDashboard(actor: Principal): Promise<CloudDashboard>` requiring `evidence.read`; `CloudDashboard = { usage: { usedBytes: number; capacityBytes: number; percent: number; level: "normal" | "warning" | "critical"; takenAt: Date } | { stale: true; takenAt: Date | null }; trend: { day: string; usedBytes: number }[]; runs: RunRow[]; deletions: DeletionRow[] }`; executive summary adds `cloudUsagePercent: number | null`.

- [ ] **Step 1: Write failing tests**: level thresholds (<65 normal, 65–75 warning, >75 critical); snapshot 27 h old → `stale`; one trend point per Bangkok day for 30 days; runs and deletions capped at 50; Executive Viewer forbidden the dashboard and sees only the percentage; Playwright: Security Operator sees the usage card, upload log and pruning log in Thai, and `page.getByRole("button", { name: /ลบ|กู้คืน|สำรองตอนนี้/ })` has count 0.
- [ ] **Step 2: Run tests**; expect FAIL.
- [ ] **Step 3: Implement** the service function and the "Cloud Backup (GDCC)" section; trend as an inline SVG line chart using existing styles.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e -- backups`; expect PASS.
- [ ] **Step 5: Commit** `feat: show GDCC cloud backup dashboard and logs`.

### Task 9: Deployment files, runbooks and glossary

**Files:**
- Create: `infrastructure/backup/README.md`, `hosxp-uploader.service.example`, `hosxp-uploader.timer.example`, `backup-agent@.service.example`, `backup-agent@.timer.example`, `logrotate.example`, `vm/seal.service.example`, `vm/seal.timer.example`, `vm/capacity-pruner.service.example`, `vm/capacity-pruner.timer.example`, `vm/vm-integrity.timer.example`, `vm/dnf-automatic.conf.example`
- Create: `docs/operations/cloud-backup-runbook.md`, `docs/operations/cloud-backup-restore-test-record.md`
- Modify: `docs/operations/backup-evidence-runbook.md`, `docs/operations/siem-backup-recovery-runbook.md`, `CONTEXT.md`
- Test: `infrastructure/backup/tests/test_deploy_examples.py`

- [ ] **Step 1: Write failing tests**: timers use `OnCalendar` with `Asia/Bangkok` and the Global Constraints times plus `Persistent=true`; client services run as user `cloud-backup` with `ProtectSystem=strict`, `PrivateTmp=yes`, `NoNewPrivileges=yes`, and the uploader lists the NAS mount in `ReadOnlyPaths=`; VM services run as root with `ReadWritePaths=/srv/backup`; no file under `infrastructure/backup/` matches an IPv4 address, `BEGIN OPENSSH PRIVATE KEY` or `AGE-SECRET-KEY-`.
- [ ] **Step 2: Run tests**; expect FAIL.
- [ ] **Step 3: Write the examples and Thai runbooks**: requesting the Backup VM from GDCC (Rocky/Alma 9, data disk ≥ 500 GB, SSH only from the hospital address, snapshots if offered); VM hardening (firewalld, sshd, automatic security updates, named admin accounts); the read-only NAS mount on the Backup Gateway; the key ceremony (generate the `age` identity offline, store in the Secrets Vault, seal the offline copy, distribute only the recipient); upload keys and the Portal key; changing upload time and bandwidth; reading logs and the dashboard; response per incident rule; one week of pruner dry-run before enabling; restore steps; quarterly restore tests with the record template. Point the Wazuh runbook's GDCC rows and the evidence runbook at the new runbook (evidence for cloud jobs is automatic; CSV import stays for other systems). Glossary terms: Backup Gateway, GDCC Backup VM, HOSxP Uploader, Capacity Pruner, Capacity Retention Policy, Restore Test Host.
- [ ] **Step 4: Run tests and the Markdown link check**; expect PASS.
- [ ] **Step 5: Commit** `docs: add cloud backup runbooks and deployment examples`.

### Task 10: Rehearsal (hospital-approved, outside git)

Only after the readiness record is complete. Harden the Backup VM and confirm from outside the hospital that only SSH is reachable and only from the hospital address; install the VM services, the Backup Gateway and the host agents; run the pruner in dry-run for one week and review its plan; run every job once by hand; confirm the Portal dashboard shows each job healthy and the usage card filled; restore one HOSxP file (on a HOSxP test server, by the HOSxP administrator), `portal-db` and `wazuh-config` under dual control and record the results. Gate: all three restores pass, and the Wazuh and Portal rebuild finishes within 24 hours.
