# Replicate the HOSxP `hos` database to a rebuilt GDCC VM

- Status: Proposed
- Date: 2026-11-10

The hospital decided on 2026-11-10 that the old data on its existing GDCC VM (the HOSxP restore server) can be wiped, and that it wants that VM to hold a live replica of the production HOSxP `hos` database. The replica gives an off-site copy that is minutes old, not a day old, and a place to run read-only checks and a faster disaster recovery than restoring a 30 GB ZIP.

Production facts (read-only checks by the hospital, 2026-11-10): MariaDB 10.11.18; `log_bin=ON`, `binlog_format=ROW`, `server_id=1`, binlog retention 14 days, `innodb_file_per_table=ON`; the `hos` schema is about 236 GB (data plus indexes); across the server there are 6,809 InnoDB, 235 MyISAM and 2 MEMORY tables.

A replica is not a backup: a deletion, a bad update or ransomware encryption on the production database replicates within seconds. The daily encrypted, upload-only backups of [ADR 0009](./0009-gdcc-cloud-backup-with-capacity-pruning.md) stay in place and stay on a separate Backup VM.

## Considered Options

- **Keep only daily ZIP backups.** Simple, but up to a day of data loss and hours to restore.
- **Replicate on the existing CentOS 7 VM as it is.** Rejected: no security updates, MySQL open to the Internet, and live patient data would sit behind it.
- **Rebuild the VM and replicate `hos` over an outbound SSH tunnel (chosen).**
- **Replicate over a site-to-site IPsec VPN from the Sophos Firewall.** Equally valid and preferred if the hospital already plans that VPN for GDCC; it needs a firewall production change.
- **Open the production MySQL port to GDCC.** Rejected: puts the HIS database on the Internet.

## Decision

- **Rebuild first.** GDCC reinstalls the VM with Rocky Linux 9 or AlmaLinux 9. Its firewall allows only SSH, only from the hospital's public address; MySQL listens on localhost only. Automatic security updates, named administrator accounts with keys, no root or password login over SSH. The data volume is encrypted (LUKS) because it holds patient data.
- **Same database engine.** The replica runs MariaDB 10.11 (the same series as production, 10.11.18 or newer).
- **Disk.** The VM gets a data volume of at least 500 GB for the replica: `hos` is about 236 GB and grows, and relay logs, temporary files and the seed need room. The current 200 GB disk is not enough.
- **Only `hos`.** The replica filters with `replicate_wild_do_table=hos.%` (replica side), so production needs no filter. Production already writes ROW binary logs with `server_id=1` and keeps them 14 days, so no production restart is needed. The replica uses a different `server_id` and MariaDB GTID (`MASTER_USE_GTID=slave_pos`).
- **Connection.** A hospital-side host (the Backup Gateway) keeps an `autossh` tunnel open to the GDCC VM with a remote forward, so the replica reaches production's MySQL through the tunnel. No inbound port is opened at the hospital. A dedicated replication account has only `REPLICATION SLAVE` (and `REPLICATION CLIENT`), is limited to the tunnel's source host, and uses TLS.
- **Seeding.** A one-off `mariabackup` of production taken at night, prepared and restored on the replica with only `hos` kept, starting from the GTID position it records. `mysqldump --single-transaction` is not used because `hos` has MyISAM tables, which it cannot snapshot consistently; `mariabackup` locks MyISAM tables only briefly at the end. The daily HOSxP ZIP cannot seed replication because it carries no binlog position.
- **Read-only.** The replica runs with `read_only` and `super_read_only` (where available). No application writes to it.
- **Monitoring.** A small check on the replica reports `Slave_IO_Running`, `Slave_SQL_Running`, `Seconds_Behind_Master` and the last error as a `cloud-backup-report/v1`-style report (job `hos-replica`) every 5 minutes. The Portal shows it on the Backup page and opens a P2 incident when replication has stopped or lags more than 15 minutes for 15 minutes.
- **Production changes are prepared, not performed.** Creating the replication account, running the seed backup and opening the tunnel are changes to the HIS; they need hospital approval and coordination with the HOSxP vendor.

## Consequences

- Production already writes binary logs with 14-day retention, so a tunnel outage of up to about 13 days can be caught up without reseeding.
- MyISAM tables in `hos` are not crash-safe: if the replica VM crashes, those tables may need repair or a reseed. MEMORY tables are empty after a replica restart, so updates to them can stop replication; the runbook lists them and either excludes them or skips their errors deliberately.
- The replica holds identifiable patient data at GDCC. Access is limited to named administrators; it must not be exposed to the Internet; any reporting from it carries only status fields, never data.
- If the tunnel is down longer than binlog retention, the replica must be reseeded.
- Failing over to the replica as the live HIS is a separate decision and runbook; this ADR covers only keeping a current copy.
