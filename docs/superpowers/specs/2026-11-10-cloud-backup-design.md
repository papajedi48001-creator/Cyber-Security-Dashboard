# Cloud Backup Design — Hospital Waritchaphum

Decision record: [ADR 0009](../../adr/0009-encrypted-immutable-cloud-backup-to-gdcc.md). Parent design: [Cyber Security Operations Dashboard](./2026-10-08-waritchaphum-cyber-security-dashboard-design.md), section "Backup and disaster recovery".

## Intent

The parent design says backups are encrypted and sent to GDCC, and that Wazuh and the Portal must be recoverable within 24 hours. It does not say which data is backed up, how it reaches GDCC, how keys are handled, or what stops ransomware on a hospital host from deleting the off-site copy. This design fills those gaps for the systems this project owns, and feeds the results into the Portal's existing Backup Evidence module without adding any backup control to the Portal.

Success means:

- Every project system has a daily encrypted off-site copy that no hospital host can delete or read.
- A restore test, run under dual control, rebuilds Wazuh and the Portal from GDCC alone within the 24-hour SIEM Recovery Objective.
- The Portal shows each backup job as ok, failing, stale, unencrypted or unknown from evidence the agents produce, and shows recovery as verified only after a passed restore test.

## Scope

In scope:

| Job | Host | Contents | Interval |
|---|---|---|---|
| `wazuh-config` | Wazuh VM | `/var/ossec/etc/` (ossec.conf, rules, decoders, client.keys), certificates and keystores, indexer security config from `securityadmin.sh -backup`, ISM policies and index templates exported from the API | 24 h |
| `portal-db` | Portal Application Server | `mariadb-dump --single-transaction --routines --triggers` of the Portal Security Database | 6 h |
| `portal-config` | Portal Application Server | Application config without secrets, reverse-proxy config, systemd units, the deployed release identifier | 24 h |
| `log-relay-config` | TLS Log Relay | syslog-ng config, allowed-source list, TLS certificates | 24 h |
| `gdcc-integrity` | Portal Application Server | Weekly integrity check of the newest bundle of every job above | 168 h |

The Wazuh Indexer Log Archive keeps its own snapshot repository ([log-archive-runbook.md](../../operations/log-archive-runbook.md)); this design only moves it to its own GDCC bucket and credentials.

Out of scope: HOSxP and other hospital systems (they keep their own backup system and may import evidence in the same CSV format), high availability, automatic restore into production, Backup File Management (Phase 4), and any Portal button that runs, restores or deletes a backup.

Secrets (database passwords, LINE token, Wazuh Service Account password) are not in any bundle. They live in the secrets mechanism and are re-issued or recovered from the Secrets Vault during a restore.

## Architecture

```text
 Wazuh VM            Portal App Server        TLS Log Relay
 backup-agent        backup-agent             backup-agent
     |                   |                         |
     | collect -> tar -> age encrypt (public key) -> sha256 -> manifest
     |                   |                         |
     +--------+----------+-----------+-------------+
              |                      |
              v                      v
   Local Backup Copy          GDCC bucket "project-backup"
   (hospital datastore,       S3, versioning, Object Lock compliance
    14 days, fast restore)    daily: lock 35 d, expire 90 d
                              monthly: lock and keep 365 d
              |
              v
   evidence CSV line  --(daily import, existing CSV import)-->  Portal Backup Evidence

 Portal App Server: integrity-check (weekly, read-only account) -> evidence line "gdcc-integrity"
 Restore Test Host: quarterly dual-control decrypt and rebuild  -> Portal Restore Verification
```

### Components

| Component | Responsibility | Boundary |
|---|---|---|
| Backup Agent (`infrastructure/backup/backup_agent.py`) | Runs the configured collect commands, builds a tar bundle, encrypts it with `age`, writes a manifest, keeps the Local Backup Copy, uploads to GDCC, appends an evidence line | Holds only the public key and a write-only credential; never uploads plaintext; never deletes remote objects |
| Integrity Check (`infrastructure/backup/integrity_check.py`) | Downloads the newest bundle per job, compares SHA-256 with its manifest, checks the `age` header | Read-only credential; never decrypts |
| GDCC bucket `project-backup` | Stores encrypted bundles and manifests with Object Lock | Lifecycle rules set once by a Security Administrator; no host credential may delete |
| GDCC bucket `log-archive` | Wazuh Indexer snapshot repository for the one-year Log Archive | Versioning, separate credential, no Object Lock |
| Local Backup Copy | Encrypted bundles on a hospital datastore separate from the VMs' own disks, kept 14 days, for fast restore | Not reachable from the Portal |
| Restore Test Host | Isolated temporary VM where restore tests run | No production network access; destroyed after each test |
| Portal Backup Evidence | Imports evidence lines, evaluates health and recovery | Existing module, read-only, unchanged |

### Object layout

```text
project-backup/<job>/daily/<YYYY>/<MM>/<job>-<YYYYMMDDTHHMMSSZ>.tar.age
project-backup/<job>/daily/<YYYY>/<MM>/<job>-<YYYYMMDDTHHMMSSZ>.manifest.json
project-backup/<job>/monthly/<YYYY>/<job>-<YYYYMM>.tar.age          (first successful run of the month)
project-backup/<job>/monthly/<YYYY>/<job>-<YYYYMM>.manifest.json
```

The monthly object is a second upload of the same bundle under the `monthly/` prefix, so a different lifecycle rule applies. Names contain no hostnames, IP addresses or usernames.

The manifest is plain JSON: job, created_at (UTC), bundle object key, size_bytes, sha256, age recipient fingerprint, agent version, and the list of collected paths. It contains no file contents and no secrets.

## Credentials and keys

| Credential | Held by | Rights |
|---|---|---|
| Backup Upload Account (one per host) | That host's secrets file, readable only by the agent's service user | `PutObject` on `project-backup/<its jobs>/*`; no list, read or delete. A put to an existing key only adds a version; the locked original stays |
| Integrity Check Account | Portal Application Server secrets file | `GetObject` and `ListBucket` on `project-backup` |
| Log Archive Account | Wazuh Indexer keystore | Read and write on `log-archive` only |
| GDCC Admin Account | Security Administrators, with MFA, never stored on a host | Bucket policy, lifecycle and Object Lock settings |
| Backup Encryption Key (`age` identity) | Secrets Vault under Dual-Control Key Recovery, and one sealed offline copy in a two-person safe | Decrypts bundles; used only on the Restore Test Host or during a real recovery |

Each host stores the `age` recipient (public key) in its agent config. Rotating the key means adding a new recipient; old bundles stay readable with the old identity until they expire.

## Evidence mapping

The agent appends one line per run to `/var/lib/backup-agent/evidence.csv` in the existing Portal import format:

```text
job,result,completed_at,size_bytes,encrypted,retention_until
portal-db,SUCCESS,2026-11-10T03:00:12Z,48213301,yes,2027-02-08T03:00:12Z
```

- `result` is `SUCCESS` only when encryption, the Local Backup Copy and the GDCC upload all succeeded. Any failed step writes `FAILED`.
- `encrypted` is `yes` only when the uploaded object starts with the `age` header; the agent never uploads anything else, so a `no` line indicates a defect.
- `retention_until` is the daily expiry (completed_at + 90 days), or + 365 days for the monthly copy.
- The Security Operator imports the day's lines in the Portal Backup page (existing workflow in [backup-evidence-runbook.md](../../operations/backup-evidence-runbook.md)). Automating the import is a later change.

The Portal's existing rules then apply unchanged: a missing line becomes stale after 1.5 × the expected interval, a failure counts consecutive failures, and recovery stays unconfirmed until a restore test passes.

## Error handling

| Failure | Behaviour |
|---|---|
| A collect command fails | No bundle is built; `FAILED` evidence line; exit code non-zero so the systemd unit is marked failed |
| `age` fails | Nothing is uploaded or kept locally; `FAILED` |
| Local Backup Copy write fails | Upload still runs; `FAILED`, because the restore-time objective depends on the local copy |
| GDCC upload fails | Retried 3 times with backoff; then `FAILED`; the local copy remains and the next run uploads a fresh bundle |
| Evidence file cannot be written | The agent exits non-zero; the Portal shows the job stale after its interval, never healthy |
| Clock not synchronised | The agent refuses to run if the host reports no NTP synchronisation, because evidence times would be wrong |

The agent never retries by deleting or overwriting a remote object; every upload uses a new timestamped key.

## Recovery

1. Restore from the Local Backup Copy when it is intact; use GDCC when it is not.
2. Two key holders open the Backup Encryption Key on the Restore Test Host or the rebuilt VM.
3. Verify the bundle's SHA-256 against its manifest, decrypt, and follow [siem-backup-recovery-runbook.md](../../operations/siem-backup-recovery-runbook.md) for Wazuh, and the new cloud backup runbook for the Portal and the relay.
4. Re-issue secrets from the Secrets Vault.

Restore tests run at least every 90 days per job on the Restore Test Host, measure the time of each step against the 24-hour objective, and are recorded as Restore Verification with a reference to the test record (table counts, checksums, timings; never data contents).

## Testing

- Unit tests (Python standard library, `unittest`) for the agent and integrity check, with fake `age`, `rclone` and collect commands on `PATH`: evidence lines for every failure path, no plaintext upload, object naming, monthly copy, manifest contents, NTP refusal.
- A local end-to-end test against a MinIO container with Object Lock enabled: upload succeeds, delete and overwrite with the upload credential are refused, integrity check passes and detects a tampered object.
- Validator tests for the restore-test record, like the existing cutover record validator.
- CI runs the unit tests; the MinIO test runs in CI when Docker is available.

## Hospital decisions and confirmations

- Confirm the cloud provider (default: GDCC, as in the parent design).
- Confirm with GDCC: S3-compatible API, versioning, Object Lock compliance mode, lifecycle rules, data-centre location in Thailand, and cost for the expected volume.
- Name at least two key holders and approve the sealed offline key location.
- Approve the Local Backup Copy datastore.
- Approve creating the buckets and installing the agent on each host as production changes.
