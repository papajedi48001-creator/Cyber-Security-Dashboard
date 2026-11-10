# Cloud Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Back up the Wazuh VM, Portal Application Server and TLS Log Relay daily as client-encrypted, immutable objects in GDCC, and feed every run into the Portal's existing Backup Evidence import.

**Architecture:** A Python Backup Agent on each host runs configured collect commands, tars the output, encrypts it with `age` to a public key, keeps a Local Backup Copy, uploads to an Object Lock bucket with a write-only credential through `rclone`, and appends a CSV evidence line in the Portal's import format. A weekly Integrity Check downloads the newest bundle per job with a read-only credential and verifies it without decrypting. The Portal is not changed.

**Tech Stack:** Python 3 standard library (`unittest`, `tarfile`, `hashlib`, `subprocess`, `json`); `age` 1.x; `rclone` 1.6x with the S3 backend; systemd timers; MinIO with Object Lock for the end-to-end test; GDCC S3-compatible object storage.

**Spec:** `docs/superpowers/specs/2026-11-10-cloud-backup-design.md` (decision: `docs/adr/0009-encrypted-immutable-cloud-backup-to-gdcc.md`)

## Global Constraints

- Never upload or keep locally anything that is not an `age` file; the only plaintext written is the manifest.
- Hosts hold only the `age` recipient (public key) and a write-only upload credential. No code path deletes or overwrites a remote object.
- Evidence format is exactly `job,result,completed_at,size_bytes,encrypted,retention_until`, times UTC ISO 8601 with `Z`, `result` `SUCCESS` or `FAILED`, `encrypted` `yes` or `no`.
- `SUCCESS` only when encryption, the Local Backup Copy and the GDCC upload all succeeded.
- Retention: daily objects lock 35 days and expire 90 days; monthly objects lock and expire 365 days; Local Backup Copy 14 days.
- Job intervals: `wazuh-config` 24 h, `portal-db` 6 h, `portal-config` 24 h, `log-relay-config` 24 h, `gdcc-integrity` 168 h.
- No secrets, hostnames, IP addresses, usernames or patient data in object keys, manifests, evidence lines, examples or tests. Commit `*.example` files only.
- The Portal gets no run, restore or delete control. Creating buckets and installing the agent are production changes that need hospital approval; this plan prepares them.
- Runbooks are Thai-first.

## Review Focus

- A collect command that hangs must time out (default 1800 s) and produce `FAILED`, not block the timer forever.
- A run on a host whose clock is not NTP-synchronised must refuse and write nothing, so evidence times are never wrong.
- Two runs in the same second must not reuse an object key (the second run fails rather than overwriting).
- Disk full while writing the Local Backup Copy must give `FAILED` and leave no partial file named like a valid bundle.
- An integrity check that finds no bundle for a job must report `FAILED` for that job, never skip it silently.

---

### Task 0: Hospital readiness record

**Files:**
- Create: `docs/operations/cloud-backup-readiness-record.md`

Thai record with one row per confirmation from the spec's "Hospital decisions and confirmations": cloud provider, GDCC S3 API, versioning, Object Lock compliance mode, lifecycle rules, data-centre location, cost estimate, two named key holders (role titles only in git), sealed key location (description only), Local Backup Copy datastore, production-change approval reference. Each row has columns `รายการ | ผล | หลักฐานอ้างอิง | ผู้ยืนยัน | วันที่`.

- [ ] **Step 1: Write the record template** with every row empty and a gate sentence: Task 7 starts only when every row is filled and Object Lock is confirmed; if Object Lock is unavailable, stop and revisit ADR 0009.
- [ ] **Step 2: Run the Markdown link check from CI locally** and expect no broken links.
- [ ] **Step 3: Commit** `docs: add cloud backup readiness record`.

### Task 1: Agent configuration and object naming

**Files:**
- Create: `infrastructure/backup/backup_agent.py`
- Create: `infrastructure/backup/jobs.example.json`
- Test: `infrastructure/backup/tests/test_config.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Job: name: str; interval_hours: int; collect: list[list[str]]; paths: list[str]; timeout_seconds: int = 1800`
  - `@dataclass(frozen=True) class AgentConfig: jobs: list[Job]; recipient: str; local_dir: Path; remote: str; evidence_file: Path; state_file: Path; local_keep_days: int = 14`
  - `load_config(path: Path) -> AgentConfig` (raises `ConfigError`)
  - `object_keys(job: str, created: datetime, monthly: bool) -> tuple[str, str]` returning `(bundle_key, manifest_key)`

- [ ] **Step 1: Write the failing tests**

```python
def test_daily_keys(self):
    t = datetime(2026, 11, 10, 3, 0, 12, tzinfo=timezone.utc)
    self.assertEqual(agent.object_keys("portal-db", t, monthly=False), (
        "portal-db/daily/2026/11/portal-db-20261110T030012Z.tar.age",
        "portal-db/daily/2026/11/portal-db-20261110T030012Z.manifest.json"))

def test_monthly_keys(self):
    t = datetime(2026, 11, 1, 0, 5, tzinfo=timezone.utc)
    self.assertEqual(agent.object_keys("portal-db", t, monthly=True)[0],
        "portal-db/monthly/2026/portal-db-202611.tar.age")

def test_rejects_bad_job_name(self):     # "../x", "a b", 129 chars -> ConfigError
def test_rejects_private_key_as_recipient(self):  # recipient starting "AGE-SECRET-KEY-" -> ConfigError
def test_requires_age_public_recipient(self):     # recipient must match ^age1[0-9a-z]{58}$
def test_example_config_loads(self):     # jobs.example.json loads; job names and intervals match Global Constraints
```

- [ ] **Step 2: Run** `python3 -m unittest discover -s infrastructure/backup/tests -v` and expect FAIL (module missing).
- [ ] **Step 3: Implement** `Job`, `AgentConfig`, `ConfigError`, `load_config`, `object_keys`. Job names match `^[A-Za-z0-9._-]{1,128}$` (the Portal's rule). `jobs.example.json` holds the four host jobs with placeholder recipient `age1` + 58 `q` characters, remote `gdcc:project-backup`, and collect commands from the spec's scope table.
- [ ] **Step 4: Run tests** and expect PASS.
- [ ] **Step 5: Commit** `feat: add backup agent configuration and object naming`.

### Task 2: Run a backup job and write evidence

**Files:**
- Modify: `infrastructure/backup/backup_agent.py`
- Test: `infrastructure/backup/tests/test_run_job.py`
- Test helper: `infrastructure/backup/tests/fakes.py` (writes fake `age`, `rclone` and `timedatectl` executables into a temp `PATH`; fake `age` writes `age-encryption.org/v1\n` + input; fake `rclone` copies into a temp "remote" dir and fails on demand or when the target exists)

**Interfaces:**
- Consumes: Task 1 types and `object_keys`.
- Produces:
  - `@dataclass(frozen=True) class Evidence: job: str; result: str; completed_at: datetime; size_bytes: int | None; encrypted: bool; retention_until: datetime | None` with `to_csv() -> str`
  - `is_age_file(path: Path) -> bool` (first line is exactly `age-encryption.org/v1`)
  - `run_job(config: AgentConfig, job: Job, clock: Callable[[], datetime] = utcnow) -> Evidence`
  - CLI: `python3 backup_agent.py --config <path> --job <name>`; exit 0 on `SUCCESS`, 1 on `FAILED`, 2 on refusal (no NTP sync)

- [ ] **Step 1: Write the failing tests**

```python
def test_success_writes_evidence_local_copy_and_remote(self):
    ev = agent.run_job(cfg, job, clock=fixed(2026, 11, 10, 3, 0, 12))
    self.assertEqual(ev.to_csv(), "portal-db,SUCCESS,2026-11-10T03:00:12Z,%d,yes,2027-02-08T03:00:12Z" % ev.size_bytes)
    self.assertTrue(agent.is_age_file(remote / "portal-db/daily/2026/11/portal-db-20261110T030012Z.tar.age"))
    self.assertEqual(json.loads(manifest.read_text())["sha256"], sha256(bundle))
    self.assertIn(ev.to_csv(), cfg.evidence_file.read_text())

def test_collect_failure_uploads_nothing(self):        # collect exits 1 -> FAILED, remote empty, local empty
def test_collect_timeout_is_failure(self):             # timeout_seconds=1, command sleeps 5 -> FAILED
def test_age_failure_uploads_nothing(self):            # fake age exits 1 -> FAILED, no plaintext tar anywhere
def test_upload_retries_then_fails(self):              # rclone fails 3 times -> FAILED, local copy kept, 3 attempts
def test_local_copy_failure_is_failed_but_uploads(self):  # local_dir read-only -> FAILED, remote has bundle, no partial file left
def test_first_run_of_month_also_uploads_monthly(self):   # second run same month: no monthly upload; state_file records month
def test_monthly_retention_is_365_days(self):          # monthly evidence line retention_until = +365 d
def test_existing_key_is_never_overwritten(self):      # same clock twice -> second FAILED, first object unchanged
def test_refuses_without_ntp_sync(self):               # timedatectl says "no" -> exit 2, no evidence line
def test_prunes_local_copies_older_than_14_days(self):
def test_manifest_has_no_secrets_or_hostnames(self):   # keys exactly: job, created_at, bundle_key, size_bytes, sha256, recipient_fingerprint, agent_version, paths
```

- [ ] **Step 2: Run tests** and expect FAIL.
- [ ] **Step 3: Implement `run_job`.** Order: NTP check (`timedatectl show -p NTPSynchronized --value` must print `yes`) → collect into a private temp dir (mode 0700) with per-command timeout → `tarfile` gzip → `age -r <recipient> -o <out>` → `is_age_file` → SHA-256 → manifest → write Local Backup Copy via temp name + `os.replace` → upload bundle then manifest with `rclone copyto --s3-no-check-bucket --s3-no-head` (the upload account cannot read, so uniqueness comes from the timestamped key plus a check that the Local Backup Copy for that key does not exist yet; 3 attempts, backoff 2, 4, 8 s, injectable for tests) → monthly upload when `state_file` has no entry for this job and month → prune local → append evidence. Delete the plaintext temp dir in `finally`. Any exception after the NTP check becomes a `FAILED` line.
- [ ] **Step 4: Run tests** and expect PASS.
- [ ] **Step 5: Commit** `feat: run encrypted backup jobs and write evidence`.

### Task 3: Integrity Check

**Files:**
- Create: `infrastructure/backup/integrity_check.py`
- Test: `infrastructure/backup/tests/test_integrity_check.py`

**Interfaces:**
- Consumes: `load_config`, `Evidence`, `is_age_file` from Task 1–2.
- Produces: `check(remote: str, jobs: list[str], clock) -> tuple[Evidence, list[str]]` returning one `gdcc-integrity` evidence line and a list of problems; CLI `python3 integrity_check.py --config <path>` exits 0 or 1 and appends the line to the evidence file.

- [ ] **Step 1: Write the failing tests** using the fake `rclone` remote dir:

```python
def test_all_jobs_ok(self):            # newest bundle per job matches manifest sha256 and age header -> SUCCESS, problems == []
def test_tampered_bundle_fails(self):  # flip one byte -> FAILED, problem names the job
def test_plaintext_object_fails(self): # object without age header -> FAILED
def test_missing_job_fails(self):      # no objects for "log-relay-config" -> FAILED, problem "no bundle"
def test_newest_bundle_older_than_interval_fails(self):  # wazuh-config newest 49 h old -> FAILED
def test_evidence_line_shape(self):    # "gdcc-integrity,SUCCESS,<now>,,yes," (no size, no retention)
```

- [ ] **Step 2: Run tests** and expect FAIL.
- [ ] **Step 3: Implement.** List with `rclone lsjson --recursive <remote>/<job>/daily/`, pick the newest `.tar.age` by key timestamp, download bundle and manifest with `rclone copyto` into a temp dir, compare, delete the temp dir. Stale limit is 2 × the job interval from the config.
- [ ] **Step 4: Run tests** and expect PASS.
- [ ] **Step 5: Commit** `feat: add weekly backup integrity check`.

### Task 4: Object Lock end-to-end test and CI

**Files:**
- Create: `infrastructure/backup/tests/test_minio_object_lock.py`
- Create: `infrastructure/backup/bucket-policy.upload.example.json`
- Create: `infrastructure/backup/bucket-policy.integrity.example.json`
- Create: `infrastructure/backup/lifecycle.example.json`
- Modify: `.github/workflows/ci.yml` (new job `backup`)

**Interfaces:**
- Consumes: CLI from Tasks 2 and 3.

- [ ] **Step 1: Write the failing test** (skipped unless `BACKUP_E2E=1`): start MinIO with a bucket created `--with-lock` and default compliance retention 35 days, create an upload user with `bucket-policy.upload.example.json` (`s3:PutObject` on `project-backup/*` only) and an integrity user with `bucket-policy.integrity.example.json`; with real `age` and `rclone`, assert: agent run succeeds; `rclone deletefile` with the upload user fails; a second upload to the same key with the upload user leaves the original version retrievable and undeletable (S3 versioning keeps it; Object Lock protects versions, not keys); the integrity check passes on the original and fails once a different newer version exists, so the runbook can recover the locked original version.
- [ ] **Step 2: Run** `BACKUP_E2E=1 python3 -m unittest infrastructure/backup/tests/test_minio_object_lock.py -v` and expect FAIL (policies missing).
- [ ] **Step 3: Write the policy and lifecycle examples.** `lifecycle.example.json`: prefix `*/daily/` expire 90 days, prefix `*/monthly/` expire 365 days, noncurrent versions expire 1 day after lock ends.
- [ ] **Step 4: Run the test** and expect PASS.
- [ ] **Step 5: Add CI job `backup`**: install `age` and `rclone`, run unit tests, then the MinIO test with `BACKUP_E2E=1` using a MinIO service container. Push the branch and expect the job green.
- [ ] **Step 6: Commit** `test: prove backup objects are immutable for the upload account`.

### Task 5: Restore test record and validator

**Files:**
- Create: `docs/operations/cloud-backup-restore-test-record.md`
- Create: `docs/operations/tests/validate_restore_test_record.py`
- Test: `docs/operations/tests/test_validate_restore_test_record.py`

**Interfaces:**
- Produces: `validate(markdown: str) -> list[str]` (errors), following `validate_cutover_record.py`.

- [ ] **Step 1: Write failing tests**: a complete synthetic record passes; missing second key holder, total time over 24 h without a corrective-action note, a 13-digit number (national ID pattern), or an IPv4 address each produce an error.
- [ ] **Step 2: Run** `python3 -m unittest discover -s docs/operations/tests -v` and expect FAIL.
- [ ] **Step 3: Implement the validator and write the Thai record template**: job, date (UTC), source (local or GDCC), two key-holder roles, per-step minutes, total, checks (SHA-256 match, table counts, Wazuh `logtest_check.py`, Portal login), result, Portal Restore Verification reference.
- [ ] **Step 4: Run tests** and expect PASS.
- [ ] **Step 5: Commit** `docs: add cloud backup restore test record`.

### Task 6: Deployment files, runbook and glossary

**Files:**
- Create: `infrastructure/backup/backup-agent@.service.example`, `infrastructure/backup/backup-agent@.timer.example`, `infrastructure/backup/integrity-check.timer.example`, `infrastructure/backup/rclone.conf.example`, `infrastructure/backup/README.md`
- Create: `docs/operations/cloud-backup-runbook.md`
- Modify: `docs/operations/siem-backup-recovery-runbook.md`, `docs/operations/backup-evidence-runbook.md`, `docs/operations/log-archive-runbook.md`, `CONTEXT.md`
- Test: `infrastructure/backup/tests/test_deploy_examples.py`

- [ ] **Step 1: Write failing tests**: every `*.example` file parses (unit files have `[Service]`/`[Timer]`); timers fire every 6 h for `portal-db`, daily for the others, weekly for the integrity check, all with `RandomizedDelaySec`; the service runs as a dedicated user with `ProtectSystem=strict`, `PrivateTmp=yes`, `NoNewPrivileges=yes`; `rclone.conf.example` has placeholder keys only; no file under `infrastructure/backup/` matches an IPv4 address or `AGE-SECRET-KEY-`.
- [ ] **Step 2: Run tests** and expect FAIL.
- [ ] **Step 3: Write the example files and the Thai runbook**: install steps per host, key ceremony (generate the `age` identity on an offline machine, store in the Secrets Vault, seal the offline copy, distribute only the recipient), daily evidence import, response when a job is `FAILED` or stale (open P3, P2 for `portal-db` or `wazuh-config` failing over 48 h), restore procedure for the Portal and the relay, key rotation, and quarterly restore tests. Link the Wazuh runbook's GDCC rows to it, change the log archive repository to the `log-archive` bucket, add glossary terms Backup Agent, Local Backup Copy, Backup Upload Account, Integrity Check, Restore Test Host.
- [ ] **Step 4: Run tests and the Markdown link check** and expect PASS.
- [ ] **Step 5: Commit** `docs: add cloud backup runbook and deployment examples`.

### Task 7: Rehearsal (hospital-approved, outside git)

Only after the readiness record is complete and the hospital approves. Install the agent on each host, run each job once by hand, import the evidence into the Portal and confirm every job shows "สำรองตามรอบ", run the integrity check, and perform the first restore test of `portal-db` and `wazuh-config` from GDCC on the Restore Test Host. Record results in the restore test record and the Portal. The plan's acceptance gate is a passed restore within 24 hours for both jobs.
