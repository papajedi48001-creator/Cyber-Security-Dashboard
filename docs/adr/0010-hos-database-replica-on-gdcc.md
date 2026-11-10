# Replicate the HOSxP `hos` database to a rebuilt GDCC VM

- Status: Proposed
- Date: 2026-11-10

The hospital decided on 2026-11-10 that the old data on its existing GDCC VM (the HOSxP restore server) can be wiped, and that it wants that VM to hold a live replica of the production HOSxP `hos` database. The replica gives an off-site copy that is minutes old, not a day old, and a place to run read-only checks and a faster disaster recovery than restoring a 30 GB ZIP.

A replica is not a backup: a deletion, a bad update or ransomware encryption on the production database replicates within seconds. The daily encrypted, upload-only backups of [ADR 0009](./0009-gdcc-cloud-backup-with-capacity-pruning.md) stay in place and stay on a separate Backup VM.

## Considered Options

- **Keep only daily ZIP backups.** Simple, but up to a day of data loss and hours to restore.
- **Replicate on the existing CentOS 7 VM as it is.** Rejected: no security updates, MySQL open to the Internet, and live patient data would sit behind it.
- **Rebuild the VM and replicate `hos` over an outbound SSH tunnel (chosen).**
- **Replicate over a site-to-site IPsec VPN from the Sophos Firewall.** Equally valid and preferred if the hospital already plans that VPN for GDCC; it needs a firewall production change.
- **Open the production MySQL port to GDCC.** Rejected: puts the HIS database on the Internet.

## Decision

- **Rebuild first.** GDCC reinstalls the VM with Rocky Linux 9 or AlmaLinux 9. Its firewall allows only SSH, only from the hospital's public address; MySQL listens on localhost only. Automatic security updates, named administrator accounts with keys, no root or password login over SSH. The data volume is encrypted (LUKS) because it holds patient data.
- **Same database engine.** The replica runs the same MySQL or MariaDB family and the same or a newer minor version as production, confirmed before installation.
- **Only `hos`.** The replica filters with `replicate_wild_do_table=hos.%` (replica side), so production needs no filter. Production binary logging uses `binlog_format=ROW` with a unique `server_id`; GTID is used if production already has it.
- **Connection.** A hospital-side host (the Backup Gateway) keeps an `autossh` tunnel open to the GDCC VM with a remote forward, so the replica reaches production's MySQL through the tunnel. No inbound port is opened at the hospital. A dedicated replication account has only `REPLICATION SLAVE` (and `REPLICATION CLIENT`), is limited to the tunnel's source host, and uses TLS.
- **Seeding.** A one-off consistent dump of `hos` with its binlog position (`--single-transaction` with `--master-data=2`, or `mariabackup`/`xtrabackup` for the matching engine), taken at night and loaded on the replica. The daily HOSxP ZIP cannot seed replication because it carries no binlog position.
- **Read-only.** The replica runs with `read_only` and `super_read_only` (where available). No application writes to it.
- **Monitoring.** A small check on the replica reports `Slave_IO_Running`, `Slave_SQL_Running`, `Seconds_Behind_Master` and the last error as a `cloud-backup-report/v1`-style report (job `hos-replica`) every 5 minutes. The Portal shows it on the Backup page and opens a P2 incident when replication has stopped or lags more than 15 minutes for 15 minutes.
- **Production changes are prepared, not performed.** Enabling binary logging (which may need one MySQL restart), creating the replication account and the tunnel are changes to the HIS; they need hospital approval and coordination with the HOSxP vendor.

## Consequences

- Production MySQL writes binary logs: extra disk and I/O on the HIS server. Binlog retention must cover the longest expected tunnel outage (default 3 days) and the HIS disk must have room for it.
- The `hos` database is about 30 GB compressed, so it may be several times larger on disk; its size decides whether the 200 GB VM disk is enough (to be measured).
- The replica holds identifiable patient data at GDCC. Access is limited to named administrators; it must not be exposed to the Internet; any reporting from it carries only status fields, never data.
- If the tunnel is down longer than binlog retention, the replica must be reseeded.
- Failing over to the replica as the live HIS is a separate decision and runbook; this ADR covers only keeping a current copy.
