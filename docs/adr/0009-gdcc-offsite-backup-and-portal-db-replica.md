# Use GDCC for encrypted offsite backups and a Portal database replica

- Status: Proposed
- Date: 2026-11-26

The hospital has received GDCC (Government Data Center and Cloud) service. The hospital chose (2026-11-26) to use it for two things:

1. **Encrypted offsite backups** of the Portal MariaDB, the Wazuh VM configuration and certificates, and the TLS Log Relay configuration. Wazuh index snapshots keep going to the `gdcc-archive` snapshot repository (log archive runbook).
2. **A Portal MariaDB replica**: a read-only MariaDB on a GDCC VM that follows the Portal MariaDB by asynchronous GTID replication over the hospital–GDCC VPN with TLS. It keeps Portal data loss to minutes if the Portal Application Server is lost.

Each host encrypts its backups before they leave the hospital, using restic. Each host has its own restic repository and its own GDCC credential, so one compromised host cannot read or delete another host's backups. A host's credential only adds data; snapshot expiry and pruning run from a separate maintenance host with a separate credential. The restic repository password is a Backup Encryption Key: it is stored in the Secrets Vault with Dual-Control Key Recovery, never in git or in GDCC.

The replica is not high availability. Nothing fails over automatically, and no Portal web or worker process runs in GDCC. Promoting the replica is a documented manual step that needs hospital approval. Wazuh is not replicated; it is recovered from backups within the 24-hour SIEM Recovery Objective.

## Considered Options

- Offsite encrypted backups only, with cold recovery in GDCC.
- Offsite encrypted backups plus a Portal MariaDB replica in GDCC (chosen).
- A full standby site in GDCC with Wazuh and Portal ready to take over. That is high availability, which the design lists as a non-goal for this phase.

## Consequences

- The design's statement that GDCC "does not host production Portal or SIEM runtime" is narrowed: GDCC hosts a read-only copy of the Portal database, and no Portal or SIEM process.
- The replica copies mistakes and deletions immediately, so it does not replace backups. Both are required.
- Portal records (incidents, audit log, user accounts with password hashes and encrypted TOTP secrets) leave the hospital. The GDCC VM must use disk encryption, accept connections only over the VPN, and hold no Portal application secrets (`TOTP_ENCRYPTION_KEY`, `SESSION_SECRET`).
- The Portal monitors the replica with a monitor-only account and shows its state. An unreachable or broken replica shows as unavailable or broken and opens an incident; it never shows as healthy.
- Backup results reach the Portal as Backup Evidence automatically through an evidence inbox. A missing run shows as stale.
- Backup Job Success and a running replica still do not prove recovery. Restore drills into a temporary VM are required and recorded as restore verifications.
- If GDCC cannot provide write-only credentials or object lock, a compromised host could delete its own backups. The runbook records which protection GDCC offers, and the hospital accepts the remaining risk explicitly.
- Creating GDCC resources, enabling binary logs on the Portal MariaDB, and installing restic or timers on hospital servers are production changes that need hospital approval. This repository only prepares them.
