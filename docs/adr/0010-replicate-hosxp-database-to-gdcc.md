# Replicate the HOSxP database to GDCC

- Status: Proposed
- Date: 2026-11-26

The hospital's plan (2026-11-26) is to keep a read-only copy of the HOSxP MariaDB in GDCC, in addition to the Portal database replica of ADR 0009. HOSxP is the hospital information system, so this copy holds patient data. It lives outside this repository's systems: the repository only documents and prepares it, and holds no HOSxP data, credentials or real addresses.

What the hospital measured on the HOSxP primary (2026-11-26):

| Item | Value |
|---|---|
| Version | MariaDB 10.11 |
| Binary log | already on, `binlog_format=ROW`, `server_id=1`, `gtid_domain_id=0`, kept 14 days, about 1.5 GB a day |
| Data to copy | about 280 GB, of which about 135 GB is in MyISAM tables |
| InnoDB buffer pool on the primary | 120 GB |

## Decision

- Use the same mechanism as ADR 0009: asynchronous GTID replication over the SSH tunnel (or the site-to-site VPN once GDCC provides it), started from the hospital side, with TLS inside the tunnel and a replication-only account.
- One MariaDB on the GDCC VM follows both primaries by multi-source replication, one named connection each (`hosxp`, `portal`). HOSxP keeps GTID domain 0; the Portal primary moves to domain 1 so the two GTID streams never collide.
- The replica is read-only, binds to 127.0.0.1, and stores its data on a separate GDCC data disk encrypted with LUKS. It does not start at boot until an administrator unlocks the disk.
- The first copy is taken with `mariabackup` to local disk on the HOSxP server, outside working hours, then transferred. Streaming straight over the internet would keep MyISAM tables write-locked for the whole transfer.
- Nothing fails over automatically. Using the copy for HOSxP is a manual step with hospital approval.

## Consequences

- Patient data leaves the hospital. The hospital must approve this under the Personal Data Protection Act B.E. 2562, and the GDCC letter states it and asks for the data-processing terms and data location.
- The current VM disk (about 490 GB free) cannot hold the copy with room to grow. The hospital asks GDCC for a separate 1 TB data disk and, if possible, 32 GB of RAM; with 16 GB the replica may fall behind under heavy load and shows as lagging.
- MyISAM tables are not crash-safe. If the replica stops abruptly they can diverge and must be re-copied. The primary is not affected.
- The binary log already exists, so the HOSxP primary needs no restart. Creating the replication account and opening the tunnel are still production changes that need approval.
- If the tunnel is down for longer than the 14-day binlog retention, the replica must be seeded again.
- The replica copies mistakes and deletions immediately; it does not replace HOSxP backups.
