# Cloud Backup Design — Hospital Waritchaphum

Decision record: [ADR 0009](../../adr/0009-gdcc-cloud-backup-with-capacity-pruning.md). Parent design: [Cyber Security Operations Dashboard](./2026-10-08-waritchaphum-cyber-security-dashboard-design.md), section "Backup and disaster recovery".

## Intent

What the hospital asked for (2026-11-10):

- Use GDCC cloud.
- Upload the HOSxP daily backup files automatically every day at a configured time.
- Check storage; when it nears the limit, delete the oldest files.
- Keep logs and show a dashboard.

Follow-up from the hospital (2026-11-10): prune at 75% and always keep at least 7 HOSxP files; the HOSxP backup files are on the hospital NAS.

Observed on the NAS (folder `HOSxP_Backup/HOSxP_Backup_Daily`), described here with placeholders only:

- One `MySQL_backup_<db-host>_<hcode>_<YYYYMMDDHHMMSS>.ZIP` per day, about 26–32 GB and growing, finished at about 04:01 Bangkok time; the dump starts at about 00:01.
- A companion `MySQL_backup_<db-host>_hos_<YYYYMMDDHHMMSS>_log.txt` of about 450 KB, written at about 02:20, and a `backup.ini`.
- On two days in the first ten days of November the ZIP was only about 55 KB, so the HOSxP backup itself failed silently on those days. The uploader must catch this.

Observed on the existing GDCC machine (checked 2026-11-10 by the hospital over SSH):

- GDCC provides a VM with a public address, not S3 object storage.
- The existing VM is a HOSxP restore server: CentOS 7 (no security updates since mid-2024), 4 vCPU, 7.6 GB RAM almost fully used, a 200 GB disk with 34 GB free, MySQL, HTTP and SSH open to the whole Internet, outbound Internet working, NTP synchronised, disk writes about 266 MB/s.
- It cannot hold even two HOSxP files and shares the risks of an exposed database, so this design uses a new dedicated Backup VM.

The parent design already says backups are encrypted and sent to GDCC and that the Portal shows Backup Evidence read-only. This design adds the uploader, the Backup VM, the capacity pruner, the logs and the dashboard, and also covers the project's own systems so Wazuh and the Portal can be rebuilt within 24 hours.

Assumptions (to be confirmed in the readiness record):

- The HOSxP backup keeps writing its files to the NAS as above. This design does not change how those files are made.
- "75%" is the point where pruning starts; pruning stops at 65% so it does not run every day.
- GDCC can provide a new VM with a supported Linux and a data disk of at least 500 GB, reachable by SSH from the hospital's public address.

Success means:

- Each day's HOSxP backup file reaches GDCC encrypted, before the configured deadline, without anyone touching it.
- Nothing on the hospital side can delete or change a backup that has reached GDCC.
- A missing or near-empty HOSxP file, a failed upload or a full disk shows on the Portal and opens an incident.
- Storage never fills: the oldest unprotected backups are removed first, on the Backup VM, and every deletion can be traced.
- A dual-control restore test rebuilds a HOSxP backup file, Wazuh and the Portal from GDCC.

## Scope

| Job | Runs on | Contents | Schedule (Asia/Bangkok, configurable) |
|---|---|---|---|
| `hosxp-daily` | Backup Gateway | New HOSxP ZIP and its `_log.txt` from the NAS folder, mounted read-only | Daily 04:30, retry until 07:00 |
| `wazuh-config` | Wazuh VM | `/var/ossec/etc/`, certificates and keystores, indexer security config, ISM policies and templates | Daily 01:00 |
| `portal-db` | Portal Application Server | `mariadb-dump --single-transaction --routines --triggers` of the Portal Security Database | Every 6 h |
| `portal-config` | Portal Application Server | Application config without secrets, reverse-proxy config, systemd units, release identifier | Daily 01:15 |
| `log-relay-config` | TLS Log Relay | syslog-ng config, allowed sources, TLS certificates | Daily 01:30 |
| `seal` | Backup VM | Moves complete uploads into the read-only store and verifies them | Every 5 minutes |
| `capacity-prune` | Backup VM | Usage check and pruning, with room reserved for the next HOSxP file | Daily 04:15, before the upload |
| `vm-integrity` | Backup VM | Re-checks the newest object of every job | Sunday 06:00 |

The Wazuh Log Archive keeps its own snapshot repository ([log-archive-runbook.md](../../operations/log-archive-runbook.md)); this design does not change it.

Out of scope: running or changing the HOSxP backup itself, fixing the existing GDCC restore server (reported separately), other hospital systems (they can still import evidence by CSV), high availability, automatic restore, and any Portal button that runs, restores or deletes a backup.

Secrets (database passwords, LINE token, Wazuh Service Account password) are not in any bundle. They are re-issued or recovered from the Secrets Vault during a restore.

## Architecture

```text
HOSxP backup (existing) --writes--> NAS: HOSxP_Backup/HOSxP_Backup_Daily
                                         | read-only SMB/NFS mount, read-only NAS account
                                         v
                              Backup Gateway (new small VM, inside the hospital)
                              - hosxp-uploader (daily 04:30)
Wazuh VM / Portal / Log Relay - backup-agent on each host
             |                           |
             +-- age encrypt (public key) -> sha256 -> manifest --+
                                                                   | SSH, key only, from the
                                                                   | hospital address only,
                                                                   | rrsync -wo (write-only)
                                                                   v
                         GDCC Backup VM (new; Rocky/Alma 9; data disk >= 500 GB; only SSH open)
                         /srv/backup/incoming/<job>/   upload-only drop zone
                         /srv/backup/store/<job>/<YYYY>/<MM>/<object>.age (+ .manifest.json)
                                                       root-owned, read-only, chattr +i
                         /srv/backup/store/_reports/<job>/<YYYY>/<MM>/<run_id>.json
                         services (root): seal, capacity-prune, vm-integrity
                                                                   |
                                     rrsync -ro on store/_reports only (Portal key)
                                                                   v
                         Security Operations Portal, Backup page
                         - disk usage vs size, 30-day trend
                         - per-job last upload and Backup Evidence
                         - upload and pruning log
                         - incidents: missing or near-empty file, failed upload,
                           capacity_blocked, stale reports
```

### Components

| Component | Responsibility | Boundary |
|---|---|---|
| HOSxP Uploader (`infrastructure/backup/hosxp_uploader.py`) | Finds new, complete HOSxP files, encrypts them, uploads them with their manifest | Read-only on the NAS; upload-only on the VM; never deletes or edits anything |
| Backup Agent (`infrastructure/backup/backup_agent.py`) | Collects, tars, encrypts and uploads a bundle for a project system | Same rules as the uploader |
| Shared client library (`infrastructure/backup/cloudbackup/`) | Config, naming, `age` and `rsync` wrappers, logs and reports | Python standard library only |
| Backup VM services (`infrastructure/backup/vm/`) | `seal.py`, `capacity_pruner.py`, `vm_integrity.py`; write reports | Run as root on the VM only; the only code that deletes |
| Portal cloud backup connector (`portal/src/lib/backups/cloud/`) | Pulls reports, writes Backup Evidence, storage snapshots, run and pruning records | Read-only key limited to `store/_reports/`; no write or delete path exists |
| Portal Backup page | Shows dashboard and logs | Read-only for every role; Executive Viewer sees counts and usage percentage only |

### Upload and sealing

1. The client encrypts the source with `age -r <recipient>` into a staging file on the Backup Gateway (or the host), hashing it, and writes a manifest: original name, original size, encrypted size, SHA-256, upload time, recipient fingerprint, `anomaly` flag. Staging needs free space equal to one encrypted file (about 32 GB for HOSxP) on the gateway; the plaintext is never copied.
2. It uploads the object and then the manifest with `rsync --partial-dir=.partial` over SSH to `incoming/<job>/`. The VM's `authorized_keys` entry for that key is `from="<hospital-address>",restrict,command="rrsync -wo /srv/backup/incoming/<job>"`. An interrupted upload resumes on retry.
3. `seal` on the VM picks up any object whose manifest has arrived and whose size has not changed for 2 minutes. It checks SHA-256 and the `age` header, moves both files into `store/<job>/<YYYY>/<MM>/`, sets owner `root`, mode `0440`, and `chattr +i`. A mismatch moves the files to `quarantine/` and writes a `FAILED` report with reason `checksum_mismatch`.
4. The client deletes its staging file only after the upload command succeeded; it does not need to see the seal.

Object names keep the original HOSxP file name plus an upload timestamp: `<original-name>.<YYYYMMDDTHHMMSSZ>.age`. The client rejects names that contain a run of exactly 13 digits (the national ID pattern; the 14-digit timestamps in HOSxP names are allowed) or characters outside `A-Za-z0-9._-`.

## HOSxP Uploader

1. At the configured time the uploader refuses to run unless the clock is NTP-synchronised.
2. It lists files in the source folder that match `MySQL_backup_*.ZIP` (the backup) and `MySQL_backup_*_log.txt` (its companion log).
3. A file is complete when a `<name>.done` marker exists, or when its size and modification time have not changed for 10 minutes. It checks again every 5 minutes until the deadline (default 07:00).
4. A file already uploaded (same name, size and modification time in the state file) is skipped.
5. Each new ZIP and its log are encrypted and uploaded as above, with a bandwidth timetable (default: unlimited until 07:30, then 20 Mbit/s). At about 32 GB a day the upload takes roughly 45 minutes at 100 Mbit/s or 90 minutes at 50 Mbit/s.
6. If no new complete ZIP appears by the deadline, the result is `FAILED`, reason `no_new_file`: the HOSxP backup did not run.
7. If the new ZIP is smaller than half the median size of the last 7 uploaded ZIPs, it is still uploaded but its manifest says `anomaly: true`, and the result is `FAILED`, reason `size_anomaly`: the HOSxP backup ran but produced a near-empty file, as seen on the NAS.
8. It writes a JSON log line per file and uploads a run report to `incoming/_reports/` (sealed into `store/_reports/` like any object), then exits 0 on success or 1 on failure.

## Capacity Pruner (on the Backup VM)

Inputs from config: `high_water` 0.75 (set by the hospital), `target` 0.65, `max_delete_fraction` 0.20, `min_age_days` 7, `min_keep` per job (`hosxp-daily` 7, set by the hospital; others 3), `reserve_bytes` (default: the largest of the last 7 HOSxP objects, about 32 GB).

1. Usage is the data disk's used bytes from `statvfs`, plus `reserve_bytes` so today's file will fit; capacity is the disk size.
2. If usage is below `high_water`, record `no_action` and stop.
3. Candidates are objects older than `min_age_days` that are not among the newest `min_keep` good objects of their job. Objects with `anomaly: true` never count toward `min_keep`, so near-empty ZIPs cannot push out the last good backups. Reports older than 400 days are candidates too.
4. Delete candidates oldest first (`chattr -i`, then remove the object and its manifest) until usage is at or below `target`, or the bytes deleted reach `max_delete_fraction` of used space.
5. If usage is still above `high_water`, record `capacity_blocked`.
6. Every deletion is a log line and an entry in the run report: object, job, size, upload time, age in days, reason `capacity`. `--dry-run` writes the same report without deleting.

Anything older than 365 days is deleted as a backstop regardless of usage, unless it is within the protected minimum.

## Logs and reports

- On each host and on the VM: JSON lines in `/var/log/cloud-backup/<job>.jsonl` and journald, rotated after 90 days. Fields: `at` (UTC), `job`, `run_id`, `event`, `object`, `size_bytes`, `duration_ms`, `result`, `reason`. No file contents, credentials or patient data.
- One report per run in `store/_reports/<job>/<YYYY>/<MM>/<run_id>.json`:

```json
{
  "format": "cloud-backup-report/v1",
  "job": "hosxp-daily",
  "run_id": "20261110T213000Z-hosxp-daily",
  "started_at": "2026-11-10T21:30:00Z",
  "finished_at": "2026-11-10T22:12:10Z",
  "result": "SUCCESS",
  "reason": null,
  "objects": [{"name": "MySQL_backup_<db-host>_<hcode>_20261111000104.ZIP.20261110T213002Z.age", "size_bytes": 34359738368, "sha256": "…", "encrypted": true, "anomaly": false}],
  "deleted": [],
  "usage": null
}
```

`usage` (`{"used_bytes", "capacity_bytes"}`) is filled by `capacity-prune` reports and `deleted` only there; `seal` and `vm-integrity` reports list the objects they checked.

## Portal dashboard

New tables (Prisma): `CloudBackupRun` (job, run_id unique, started_at, finished_at, result, reason, object count, bytes), `CloudBackupDeletion` (run_id, object, job, size, uploaded_at, reason), `CloudStorageSnapshot` (taken_at, used_bytes, capacity_bytes). A worker cycle every 15 minutes, with connector name `gdcc-backup` in `ConnectorState`, runs `rsync` over SSH with the Portal's read-only key to copy new report files since its checkpoint into a local cache, parses them, stores them, and for each run of a registered Backup Job writes a Backup Evidence row recorded by `system:gdcc-backup`. The existing health rules then apply unchanged.

The Backup page gains a "Cloud Backup (GDCC)" section, Thai-first, times in Asia/Bangkok:

- Usage card: used / capacity and percentage, coloured normal below 65%, warning 65–75%, critical above 75%; shows "ไม่มีข้อมูลล่าสุด" when the newest snapshot is older than 26 hours instead of a number.
- 30-day usage trend.
- Per-job table: last successful upload, size, consecutive failures, health from Backup Evidence.
- Upload log: latest 50 runs with result and reason.
- Pruning log: latest 50 deletions with object, size and age.

Incidents through the existing incident service: `hosxp-daily` `FAILED` (including `size_anomaly`) → P2; `checksum_mismatch` → P2; any other job `FAILED` twice in a row → P3; `capacity_blocked` → P2; no report from a job for 2 × its interval → P3 (the existing stale rule). Executive Viewer sees only job counts by health and the usage percentage.

## Access and keys

| Access | Held by | Rights |
|---|---|---|
| Upload key (one per uploading host) | That host, readable only by its service user | `rrsync -wo` into `incoming/<its job>/` and `incoming/_reports/`, from the hospital address |
| Portal report key | Portal Application Server | `rrsync -ro` on `store/_reports/` only |
| Administrator accounts on the VM | Named Security Administrators, personal keys, `sudo` | Maintenance; every login logged; no shared account; no root login over SSH |
| Backup Encryption Key (`age` identity) | Secrets Vault under Dual-Control Key Recovery, plus one sealed offline copy | Decrypts backups; used only on the Restore Test Host or in a real recovery |

The VM firewall allows TCP 22 only from the hospital's public address. Password authentication is off.

## Error handling

| Failure | Behaviour |
|---|---|
| NAS folder not mounted or unreadable | `FAILED`, reason `source_unavailable`; nothing uploaded |
| No new complete HOSxP file by the deadline | `FAILED`, reason `no_new_file` |
| New HOSxP ZIP much smaller than usual | Uploaded and marked, `FAILED`, reason `size_anomaly`, P2 incident |
| Not enough staging space on the gateway | `FAILED`, reason `staging_full`; nothing uploaded |
| Upload interrupted or VM unreachable | Retry 3 times (30 s, 2 min, 8 min), resuming the partial file; then `FAILED`, reason `upload_failed` |
| Checksum or header wrong when sealing | Moved to `quarantine/`, `FAILED`, reason `checksum_mismatch`, P2 |
| Usage cannot reach target within protections | `capacity_blocked`, P2; nothing beyond the allowed deletions |
| Clock not synchronised | Refuse to run; the Portal shows the job stale |
| Portal cannot reach the VM | `ConnectorState.lastError` set; dashboard shows stale, never zero |

## Recovery

1. Find the object in the Portal's upload log.
2. An administrator copies it and its manifest from `store/` to the Restore Test Host (or the rebuilt server) and checks SHA-256.
3. Two key holders open the Backup Encryption Key there and run `age -d`.
4. HOSxP: hand the decrypted ZIP to the HOSxP administrator's normal restore procedure on a test server first. Wazuh: [siem-backup-recovery-runbook.md](../../operations/siem-backup-recovery-runbook.md). Portal and relay: the new cloud backup runbook.

Restore tests run at least every 90 days per job and are recorded as Restore Verification with a reference (checksums, table counts, timings; never data contents).

## Testing

- Python `unittest` with fake `age`, `rsync` and `timedatectl` executables on `PATH` and synthetic files only: completion detection, skip of uploaded files, `no_new_file`, `size_anomaly`, staging space, retries, no plaintext copies, name rules, report contents.
- VM services tested against a temp directory tree (with `chattr` faked): sealing, quarantine, pruning order, `min_keep` with anomalies, `min_age_days`, reserve, delete cap, `capacity_blocked`, dry-run.
- End-to-end in CI: an OpenSSH server container with `rrsync`; prove the upload key cannot list, read or delete and the Portal key can only read reports.
- Portal Vitest: report parsing and validation, evidence creation, incident rules, stale usage, executive redaction; DB test for the new tables; Playwright for the dashboard by role.

## Hospital decisions and confirmations

- Cloud provider: GDCC (decided 2026-11-10).
- Storage target: a new dedicated GDCC Backup VM (recommended 2026-11-10; awaiting the hospital's choice). Request from GDCC: Rocky Linux 9 or AlmaLinux 9, 2 vCPU, 4 GB RAM, a data disk of at least 500 GB, a public address with only SSH allowed from the hospital's public address, and VM snapshots if offered.
- Whether SSH to GDCC needs the FortiClient VPN; if so, a permanent path for the Backup Gateway and the Portal (site-to-site IPsec on Sophos preferred, `openfortivpn` otherwise).
- HOSxP files on the NAS: folder and name pattern known (above); a read-only NAS account for the gateway; Internet upload bandwidth.
- Upload time (default 04:30), deadline (07:00) and bandwidth timetable.
- Retention policy: pruning at 75% and keeping at least 7 HOSxP files (decided 2026-11-10); stop point 65% to confirm; confirmation that this meets record-retention obligations.
- Two key holders and the sealed offline key location.
- Backup Gateway VM and installation approvals.
