# Cloud Backup Design — Hospital Waritchaphum

Decision record: [ADR 0009](../../adr/0009-gdcc-cloud-backup-with-capacity-pruning.md). Parent design: [Cyber Security Operations Dashboard](./2026-10-08-waritchaphum-cyber-security-dashboard-design.md), section "Backup and disaster recovery".

## Intent

What the hospital asked for (2026-11-10):

- Use GDCC cloud.
- Upload the HOSxP daily backup files automatically every day at a configured time.
- Check storage; when it nears the limit, delete the oldest files.
- Keep logs and show a dashboard.

The parent design already says backups are encrypted and sent to GDCC and that the Portal shows Backup Evidence read-only. This design adds the uploader, the capacity pruner, the logs and the dashboard, and also covers the project's own systems so Wazuh and the Portal can be rebuilt within 24 hours.

Assumptions (to be confirmed in the readiness record):

- HOSxP already writes its daily backup files (for example a database dump) to a folder the hospital controls. This design does not change how those files are made.
- The GDCC allocation has a fixed quota in bytes that the hospital knows; S3 does not report quotas, so the quota is configured.

Success means:

- Each day's HOSxP backup file reaches GDCC encrypted, before the configured deadline, without anyone touching it.
- A missing HOSxP file, a failed upload or a full bucket shows on the Portal and opens an incident.
- Storage never fills: the oldest unprotected backups are removed first, and every deletion can be traced.
- A dual-control restore test rebuilds a HOSxP backup file, Wazuh and the Portal from GDCC.

## Scope

| Job | Runs on | Contents | Schedule (Asia/Bangkok, configurable) |
|---|---|---|---|
| `hosxp-daily` | Backup Gateway | New HOSxP backup files from the read-only source folder | Daily 02:00 |
| `wazuh-config` | Wazuh VM | `/var/ossec/etc/`, certificates and keystores, indexer security config, ISM policies and templates | Daily 01:00 |
| `portal-db` | Portal Application Server | `mariadb-dump --single-transaction --routines --triggers` of the Portal Security Database | Every 6 h |
| `portal-config` | Portal Application Server | Application config without secrets, reverse-proxy config, systemd units, release identifier | Daily 01:15 |
| `log-relay-config` | TLS Log Relay | syslog-ng config, allowed sources, TLS certificates | Daily 01:30 |
| `capacity-prune` | Backup Gateway | Usage check and pruning | Daily 05:00, after the upload window |
| `gdcc-integrity` | Portal Application Server | Weekly integrity check of the newest object of each job | Sunday 06:00 |

The Wazuh Log Archive keeps its own snapshot repository in a separate GDCC bucket `log-archive` ([log-archive-runbook.md](../../operations/log-archive-runbook.md)); the pruner never touches it.

Out of scope: running or changing the HOSxP backup itself, other hospital systems (they can still import evidence by CSV), high availability, automatic restore, and any Portal button that runs, restores or deletes a backup.

## Architecture

```text
HOSxP backup (existing) --writes--> backup folder
                                         | read-only mount
                                         v
                              Backup Gateway (new small VM)
                              - hosxp-uploader  (daily, configured time)
                              - capacity-pruner (after upload window)
                                         |
Wazuh VM / Portal App Server / Log Relay |   each: backup-agent (own schedule)
             |                           |
             +-------- age encrypt (public key) -> sha256 -> upload ----+
                                                                         v
                                       GDCC bucket "project-backup" (S3, versioning,
                                       Object Lock compliance 7 days, quota from GDCC)
                                       <job>/<YYYY>/<MM>/<object>.age
                                       <job>/<YYYY>/<MM>/<object>.manifest.json
                                       _reports/<job>/<YYYY>/<MM>/<run-id>.json
                                                                         |
                                       read-only pull (worker, every 15 min)
                                                                         v
                                       Security Operations Portal, Backup page
                                       - usage vs quota, 30-day trend
                                       - per-job last upload and Backup Evidence
                                       - upload and pruning log
                                       - incidents: missing file, failed upload,
                                         capacity_blocked, stale reports
```

### Components

| Component | Responsibility | Boundary |
|---|---|---|
| HOSxP Uploader (`infrastructure/backup/hosxp_uploader.py`) | Finds new, complete HOSxP files, streams them through `age` to GDCC, records each upload | Read-only access to the source folder; write-only GDCC account; never deletes or edits source files |
| Backup Agent (`infrastructure/backup/backup_agent.py`) | Collects, tars, encrypts and uploads a bundle for a project system | Same credential rules as the uploader |
| Capacity Pruner (`infrastructure/backup/capacity_pruner.py`) | Measures bucket usage, deletes oldest unprotected objects when over the high-water mark | Only process with delete rights; own service user; obeys protections; dry-run mode |
| Integrity Check (`infrastructure/backup/integrity_check.py`) | Verifies newest object per job by SHA-256 and `age` header | Read-only; never decrypts |
| Shared library (`infrastructure/backup/cloudbackup/`) | Config, object naming, `age` and `rclone` wrappers, report and log writing | Python standard library only |
| GDCC bucket `project-backup` | Stores encrypted objects, manifests and reports | Bucket settings only via GDCC admin account |
| Portal cloud backup connector (`portal/src/lib/backups/cloud/`) | Pulls reports and usage, writes Backup Evidence, storage snapshots, run and pruning records | Read-only GDCC account; no delete or write call exists in the client |
| Portal Backup page | Shows dashboard and logs | Read-only for every role; Executive Viewer sees counts and usage percentage only |

## HOSxP Uploader

1. At the configured time the uploader refuses to run unless the clock is NTP-synchronised.
2. It lists files in the source folder that match the configured patterns (for example `*.sql.gz`, `*.7z`).
3. A file is complete when a `<name>.done` marker exists, or when its size and modification time have not changed for 10 minutes. Incomplete files are retried until the configured deadline (default 06:00).
4. A file already uploaded (same name, size and modification time in the state file) is skipped.
5. Each new file streams through `age -r <recipient>` into `rclone rcat` so no plaintext copy is made; the uploader hashes the encrypted stream and writes a manifest (original name, size, encrypted size, SHA-256, upload time, recipient fingerprint). Uploads respect a configured bandwidth limit.
6. If no new complete file appears by the deadline, the run result is `FAILED` with reason `no_new_file`: this catches a failed HOSxP backup.
7. It writes a JSON log line per file and a run report object, then exits 0 on success or 1 on failure.

Object key: `hosxp-daily/<YYYY>/<MM>/<original-name>.<YYYYMMDDTHHMMSSZ>.age`. File names are kept because staff need them to find a backup; the uploader rejects names that contain a 13-digit number or characters outside `A-Za-z0-9._-`.

## Capacity Pruner

Inputs from config: `quota_bytes`, `high_water` (0.85), `target` (0.75), `max_delete_fraction` (0.20), `min_keep` per job (`hosxp-daily`: 7, others: 3).

1. List every object version in `project-backup` with size, upload time and Object Lock retain-until date. Usage is the sum of all version sizes, because old versions still use quota.
2. If usage is below `high_water`, record `no_action` and stop.
3. Candidates are versions whose lock has expired and that are not among the newest `min_keep` objects of their job. Reports under `_reports/` older than 400 days are candidates too.
4. Delete candidates oldest first, each with its manifest, until usage is at or below `target`, or the bytes deleted reach `max_delete_fraction` of usage.
5. If usage is still above `high_water`, record `capacity_blocked`.
6. Every deletion is a log line and an entry in the run report: object key, job, size, upload time, age in days and reason `capacity`. `--dry-run` prints the same plan without deleting.

The bucket lifecycle rule still expires anything older than 365 days as a backstop.

## Logs and reports

- On each host: JSON lines in `/var/log/cloud-backup/<job>.jsonl` and journald, rotated by logrotate after 90 days. Fields: `at` (UTC), `job`, `run_id`, `event`, `object_key`, `size_bytes`, `duration_ms`, `result`, `reason`. No file contents, credentials or patient data.
- In GDCC: one report per run at `_reports/<job>/<YYYY>/<MM>/<run_id>.json`:

```json
{
  "format": "cloud-backup-report/v1",
  "job": "hosxp-daily",
  "run_id": "20261110T190000Z-hosxp-daily",
  "started_at": "2026-11-10T19:00:00Z",
  "finished_at": "2026-11-10T19:42:10Z",
  "result": "SUCCESS",
  "reason": null,
  "objects": [{"key": "hosxp-daily/2026/11/hosxp-20261111.sql.gz.20261110T190002Z.age", "size_bytes": 5368709120, "sha256": "…", "encrypted": true}],
  "deleted": [],
  "usage": {"used_bytes": 1200000000000, "quota_bytes": 2000000000000}
}
```

`usage` appears only in `capacity-prune` reports; `deleted` only there too.

## Portal dashboard

New tables (Prisma): `CloudBackupRun` (job, run_id unique, started_at, finished_at, result, reason, object count, bytes), `CloudBackupDeletion` (run_id, object key, job, size, uploaded_at, reason), `CloudStorageSnapshot` (taken_at, used_bytes, quota_bytes). A worker cycle every 15 minutes, using connector name `gdcc-backup` in `ConnectorState`, lists new `_reports/` objects since its checkpoint, stores them, and for each run of a registered Backup Job writes a Backup Evidence row recorded by the system actor. The existing health rules then apply unchanged.

The Backup page gains a "Cloud Backup (GDCC)" section, Thai-first, times in Asia/Bangkok:

- Usage card: used / quota and percentage, coloured normal below 75%, warning 75–85%, critical above 85%; shows "ไม่มีข้อมูลล่าสุด" when the newest snapshot is older than 26 hours instead of a number.
- 30-day usage trend.
- Per-job table: last successful upload, size, consecutive failures, health from Backup Evidence.
- Upload log: latest 50 runs with result and reason.
- Pruning log: latest 50 deletions with object, size and age.

Incidents are opened through the existing incident service: `hosxp-daily` `FAILED` → P2; any other job `FAILED` twice in a row → P3; `capacity_blocked` → P2; no report from any job for 2 × its interval → P3 (the existing stale rule). Executive Viewer sees only job counts by health and the usage percentage.

## Credentials and keys

| Credential | Held by | Rights |
|---|---|---|
| Upload account (one per uploading host) | That host, readable only by the job's service user | `PutObject` on its job prefixes and `_reports/<its jobs>/` |
| Pruner account | Backup Gateway, separate service user | `ListBucketVersions`, `GetObject`, `DeleteObjectVersion` on `project-backup` |
| Read-only account | Portal Application Server (Portal worker and Integrity Check) | `ListBucket`, `ListBucketVersions`, `GetObject` |
| GDCC admin account | Security Administrators with MFA, never on a host | Bucket, lock and lifecycle settings |
| Backup Encryption Key (`age` identity) | Secrets Vault under Dual-Control Key Recovery, plus one sealed offline copy | Decrypts backups; used only on the Restore Test Host or in a real recovery |

## Error handling

| Failure | Behaviour |
|---|---|
| Source folder not mounted or unreadable | `FAILED`, reason `source_unavailable`; nothing uploaded |
| No new complete HOSxP file by the deadline | `FAILED`, reason `no_new_file` |
| `age` or `rclone` fails mid-stream | Retry the file up to 3 times (backoff 30 s, 2 min, 8 min); each retry uses a new timestamped key; then `FAILED`, reason `upload_failed` |
| Report upload fails | Keep the report locally and upload it on the next run; the Portal shows the job stale meanwhile |
| GDCC unreachable for the pruner | `FAILED`, reason `gdcc_unreachable`; nothing deleted |
| Usage cannot reach target within protections | `capacity_blocked`, P2 incident; nothing beyond the allowed deletions |
| Clock not synchronised | Refuse to run; no report; the Portal shows stale |
| Portal cannot reach GDCC | `ConnectorState.lastError` set; dashboard shows stale, never zero |

## Recovery

1. Find the object in the Portal's upload log or with `rclone lsl` using the read-only account.
2. Download it and its manifest; check SHA-256.
3. Two key holders open the Backup Encryption Key on the Restore Test Host (or the rebuilt server) and run `age -d`.
4. HOSxP: hand the decrypted file to the HOSxP administrator's normal restore procedure on a test server first. Wazuh: [siem-backup-recovery-runbook.md](../../operations/siem-backup-recovery-runbook.md). Portal and relay: the new cloud backup runbook.

Restore tests run at least every 90 days per job and are recorded as Restore Verification with a reference (checksums, table counts, timings; never data contents).

## Testing

- Python `unittest` with fake `age`, `rclone` and `timedatectl` executables on `PATH` and synthetic files only: completion detection, skip of uploaded files, `no_new_file`, retries, no plaintext anywhere, name rules, report contents, pruning order, protections, delete cap, `capacity_blocked`, dry-run.
- End-to-end against MinIO with Object Lock: upload account cannot delete; pruner cannot delete locked versions; pruning frees space oldest first.
- Portal Vitest: report parsing and validation, evidence creation, incident rules, stale usage, executive redaction; DB test for the new tables; Playwright for the dashboard by role.

## Hospital decisions and confirmations

- Cloud provider: GDCC (decided 2026-11-10).
- From GDCC: S3 API, versioning, Object Lock compliance mode, quota, location, bandwidth, cost.
- HOSxP backup folder location, file name pattern, size, the time the daily file is finished, and whether a `.done` marker can be written.
- Upload time, deadline and bandwidth limit.
- Retention policy: thresholds, protected minimums, and confirmation that they meet record-retention obligations.
- Two key holders and the sealed offline key location.
- Backup Gateway VM and installation approvals.
