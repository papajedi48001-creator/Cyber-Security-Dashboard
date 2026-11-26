# GDCC Offsite Backup and Portal Database Replica — Design

## Intent

The hospital now has GDCC service. Use it to keep encrypted, offsite copies of everything needed to rebuild the security operations stack (Wazuh VM, TLS Log Relay, Security Operations Portal and Portal MariaDB) so that a site loss, ransomware or a failed server can be recovered within the 24-hour SIEM Recovery Objective. The hospital also chose (2026-11-26) to keep a read-only replica of the Portal MariaDB on a GDCC VM, so Portal records lose at most minutes of data. Results must show up in the Portal as Backup Evidence without manual typing, so a silent failure is noticed.

Decision record: [ADR 0009](../../adr/0009-gdcc-offsite-backup-and-portal-db-replica.md).

## Goals

- Daily encrypted backup of the Portal MariaDB (it is not covered by any existing runbook).
- Daily encrypted backup of Wazuh manager configuration, certificates, keystores and the indexer security export (the "what to back up" table in the SIEM backup runbook).
- Daily encrypted backup of the TLS Log Relay configuration and certificates.
- Wazuh index snapshots continue to the `gdcc-archive` snapshot repository (log archive runbook), now pointed at GDCC storage.
- Every backup run produces Backup Evidence that the Portal imports automatically.
- A documented, rehearsed recovery onto a temporary VM (in GDCC or on the hospital hypervisor).

- A read-only Portal MariaDB replica on a GDCC VM, monitored by the Portal.

## Non-goals and anti-goals

- No automatic failover and no Portal web or worker process in GDCC. Promoting the replica is a manual, approved runbook step.
- No Wazuh replica; Wazuh recovers from backups.
- No backup, restore or delete control in the Portal. The Portal only reads evidence (spec, Hard boundaries).
- No patient data: HOSxP is out of scope; only the security stack is backed up.
- Failure: backups that exist but cannot be decrypted because the key was lost, or that a compromised host can delete. Key escrow and credential separation are therefore part of the design, not extras.

## Recovery objectives

| Item | RPO | RTO |
|---|---|---|
| Portal MariaDB (replica) | minutes (replication lag, alert above 5 min) | 24 h (rebuild Portal app, point at promoted replica) |
| Portal MariaDB (backup, for corruption or deletion) | 24 h | 24 h |
| Wazuh configuration, certificates, security config | 24 h (and after each change) | 24 h |
| Wazuh alerts needed for operations (last 7–30 days) | 24 h (daily snapshot) | 24 h |
| Older Wazuh indices (Log Archive) | 24 h | best effort after core recovery |

These are starting values that match the approved SIEM Recovery Objective; the hospital confirms them before production.

## Approaches considered

1. **Offsite encrypted backup with cold recovery.** restic on each host, client-side encryption, one repository per host, evidence to the Portal. Cheapest, meets the 24-hour objective.
2. **Backup plus a Portal MariaDB replica on a GDCC VM (chosen by the hospital).** Adds RPO of minutes for Portal records at the cost of an always-on VM and VPN, replication monitoring, and a second database to patch.
3. **Full standby site.** Wazuh and Portal ready in GDCC. High availability is a non-goal; cost and operating load are high.

## Design

### Backup tool

restic, because it encrypts on the client (AES-256, authenticated), deduplicates, verifies (`restic check`), and supports both GDCC object storage (S3-compatible backend) and a GDCC VM (SFTP backend). Which backend applies depends on the GDCC services received; the configuration supports either.

A small wrapper, `infrastructure/gdcc-backup/gdcc_backup.py` (Python standard library, like the other infrastructure tools), runs the configured jobs on each host:

1. Runs the job's pre-commands (for example a consistent `mariadb-dump`).
2. Runs `restic backup --json` with a `job=<name>` tag.
3. Writes one Backup Evidence line per job (`job,result,completed_at,size_bytes,encrypted,retention_until`, the format the Portal already imports) into an outbox directory, atomically.
4. Exits non-zero if any job failed, so systemd and monitoring see it.

A separate `prune` command, run only on the maintenance host, applies retention (`restic forget --prune`) and a sampled `restic check --read-data-subset`.

The wrapper refuses a `RESTIC_PASSWORD` environment variable and requires `RESTIC_PASSWORD_FILE`, so the key does not leak into process listings or unit files. It never prints credentials or repository passwords; restic error output is truncated before logging.

### Repositories and credentials

| Host | Repository | Credential on host | Contents |
|---|---|---|---|
| Portal Application Server | `portal` | write-only | MariaDB dump, Portal configuration (not secrets) |
| Wazuh VM | `wazuh` | write-only | `/var/ossec/etc`, certificates, keystore, `securityadmin.sh -backup` output, ISM policy export |
| TLS Log Relay | `log-relay` | write-only | syslog-ng configuration, certificates, allowed sources |
| Maintenance host | all three | prune/delete | none (runs retention and checks only) |

Write-only means the GDCC credential can create objects but not delete them (bucket policy or object lock, if GDCC offers it). If GDCC cannot provide that, the runbook records the gap and the hospital accepts it.

Secrets backed up: none. Portal `.env` values, restic passwords and GDCC credentials live in the Secrets Vault, which has its own escrow. TLS private keys are backed up only inside the encrypted repository.

### Retention

Default per job: 35 daily, 12 weekly, 12 monthly snapshots. Wazuh index snapshots follow the existing one-year Log Archive policy.

### Evidence flow to the Portal

```text
host: gdcc_backup.py ──writes──> /var/spool/gdcc-backup/outbox/*.csv
      systemd ExecStopPost (always runs) ──rsync over SSH, forced command──> Portal host inbox
Portal worker (every 5 min) ──imports *.csv as "system:gdcc-backup"──> Backup Evidence
                            └─moves the file to inbox/processed/
```

- On the Portal host itself the outbox is the inbox.
- The Portal reads `BACKUP_EVIDENCE_INBOX` (optional). If unset, the cycle is off and evidence can still be imported by hand on the Backup page.
- Files beginning with `.` (rsync temp files) are ignored; a file over 64 KB is rejected and moved to `inbox/rejected/`.
- Each import writes an audit record with the file name, imported and rejected counts.
- Backup jobs must exist in the Portal (created by a Security Administrator) with the same names; lines for unknown jobs are rejected and counted, never auto-created.
- A host that stops sending evidence makes its job "stale" in the Portal through the existing freshness rule.

### Portal MariaDB replica

- **Topology:** Portal MariaDB (primary, hospital) → asynchronous GTID replication → `portal-replica` MariaDB on a GDCC VM. Same MariaDB major version (10.11 LTS, as in CI).
- **Primary settings** (`infrastructure/gdcc-replica/primary.cnf.example`): unique `server_id`, `log_bin`, `binlog_format=ROW`, `gtid_strict_mode=ON`, binary logs kept 7 days (`binlog_expire_logs_seconds`), `sync_binlog=1`. Enabling binary logs needs a MariaDB restart: a production change.
- **Replica settings** (`replica.cnf.example`): `read_only=ON`, `relay_log_recovery=ON`, `skip_name_resolve`, listens only on the VPN interface, data directory on an encrypted (LUKS) volume.
- **Transport:** TLS with server certificate verification (`MASTER_SSL=1`, `MASTER_SSL_VERIFY_SERVER_CERT=1`) over one of: a site-to-site IPSec VPN (preferred long term); an SSH reverse tunnel opened outbound from the Portal server with autossh (`-R` for replication, `-L` for the Portal health check), when the GDCC VM accepts TCP 22 from the hospital's public address only; or `openfortivpn` on the Portal server with a machine VPN account when GDCC offers SSL-VPN only. An administrator's FortiClient session is never the replication path. Port 3306 is never exposed to the internet on either side. As of 2026-11-26 the GDCC address accepted neither 22 nor 443 from the hospital network, so the network path is pending GDCC.
- **Tunnel key:** limited with `restrict,port-forwarding,command="/bin/false",permitlisten=...,permitopen=...`; the rehearsal showed `restrict` alone still allows running commands.
- **Rehearsal:** `infrastructure/gdcc-replica/lab/run-lab.sh` runs both servers, sshd and the tunnel on one machine and checks TLS verification, read-only replica, portal-only filtering, monitor-only access, and recovery after the tunnel drops. CI runs it.
- **Accounts:** `repl` with `REPLICATION SLAVE` only, `REQUIRE SSL`, host-restricted to the replica address. `portal-monitor` on the replica with `SLAVE MONITOR` only (MariaDB ≥10.5.9), host-restricted to the Portal server. No application account exists on the replica until promotion.
- **Initial seed:** `mariadb-dump --single-transaction --gtid --master-data=1` from the primary (or `mariabackup`), restored on the replica, then `CHANGE MASTER TO ... MASTER_USE_GTID=slave_pos`.
- **Promotion (manual, approved):** stop replication, `RESET SLAVE ALL`, `SET GLOBAL read_only=OFF`, create the application account, rebuild the Portal app server and point `DATABASE_URL` at it. The old primary must not come back as a writer; it is rebuilt as a new replica.

### Replica monitoring in the Portal

- Optional setting `PORTAL_REPLICA_MONITOR_URL` (a `mysql://` URL for the `portal-monitor` account). When unset, the Backup page says replica monitoring is not configured (never "healthy").
- The worker runs `SHOW REPLICA STATUS` every 5 minutes and stores the latest check in a `ReplicaCheck` row: state, lag seconds, IO and SQL thread state, a truncated last error, checked time, consecutive failures.
- States: **healthy** (both threads running, lag ≤ 300 s), **lagging** (running, lag > 300 s or unknown), **broken** (a thread stopped or an error), **unavailable** (cannot connect or not configured as a replica). The page shows **stale** when the latest check is older than 15 minutes, because the worker itself may be down.
- After 2 consecutive checks that are broken, unavailable or lagging, the worker opens a P3 incident (category `replica_health`, source `portal-db-replica`) through the existing finding path, which deduplicates on an active incident. P3 because the production Portal is unaffected; losing the replica only removes protection.
- Errors are reduced to a short message; connection strings and credentials are never logged or shown.

### Recovery

Recovery uses a temporary VM, never restores over a running production system, and follows the existing SIEM backup runbook order. The new GDCC runbook adds: obtaining the restic key through Dual-Control Key Recovery, `restic restore` per repository, importing the MariaDB dump, and recording the drill as a restore verification in the Portal. Drill at least every 90 days per job (the Portal's verification validity).

## Constraints

- No credentials, endpoints, bucket names or real IPs in git; `*.example` files only.
- Times in UTC in evidence; systemd timers are scheduled in Asia/Bangkok.
- Installing restic, timers or credentials on hospital servers and creating GDCC buckets are production changes needing hospital approval.

## Left to the builder

- Exact systemd hardening options.
- The forced-command mechanism for evidence delivery (`rrsync` or an equivalent restricted shell).

## Open questions for the hospital

- GDCC VM size for the replica (2 vCPU, 4 GB RAM and 50 GB encrypted disk is the proposed minimum for Portal data).

- Which GDCC services were received (S3-compatible object storage, VM, database) and their quotas.
- Network path to GDCC (IPSec VPN or internet with TLS).
- Whether GDCC supports write-only credentials, bucket policies or object lock.
- Confirmation of RPO 24 h / RTO 24 h.
