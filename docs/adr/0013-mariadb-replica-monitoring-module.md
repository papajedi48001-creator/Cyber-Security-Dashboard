# Monitor MariaDB master/replica pairs in a read-only module

- Status: Proposed
- Date: 2026-11-24

ADR 0010 proposes a live replica of the HOSxP `hos` database on a rebuilt GDCC VM. On 2026-11-24 the hospital asked for a MariaDB Replica module with four things:

- configurable master/replica server pairs;
- a card comparing master and replica data volume as a percentage, updated in real time;
- a table comparing database names on both sides;
- other useful checks.

The hospital approved the clickable prototype the same day.

## Considered Options

- **The Portal connects to both databases and reads `information_schema`.** Table sizes there are visible only for tables the account has privileges on. That would give the Portal read access to patient data, so this option is rejected.
- **A small Replica Reporter on each database host reports status; the Portal reads the reports (chosen).** The reporter reads the size of the data directory per database from the file system. It reads replication status with an account that has only `BINLOG MONITOR` and `SLAVE MONITOR`, and it holds no data privileges.
- **Use the replication tools' own dashboards (for example a monitoring stack).** This would mean another product to run, and it would not feed incidents or the audit trail.

## Decision

- **Replica pair.** A pair is configured in the module. It records the master and replica hosts and ports, how the replica reaches the master (internal network or SSH tunnel), the replication filter (for example `hos.%`), whether TLS is required, and the collection method. The reporter account's password is stored as a core connector credential (ADR 0011).
- **Replica Status Report.** Each reporter sends a `db-replica-report/v1` report. Status is reported every 10 seconds and sizes every 5 minutes. The report contains:
  - IO and SQL thread state;
  - `Seconds_Behind_Master`;
  - GTID positions;
  - the last error number and text;
  - per-database size and table count.

  It never contains row data. The hos pair at GDCC sends its report through the same path as the `hos-replica` job of ADR 0010.
- **Volume percentage.** The card divides replica size by master size, over databases that match the replication filter only. The interface labels it as an estimate: file sizes differ slightly because of how pages are stored, so it is read together with lag, table counts and the checksum result.
- **Database table.** Each database is shown with one of these states:
  - matching;
  - missing on replica;
  - tables missing;
  - size differs by more than 2%;
  - not replicated by filter (expected, not an error);
  - system database (hidden by default).
- **Other views:**
  - a lag sparkline;
  - the transactions still to apply;
  - the last consistency check, which is a scheduled checksum run on the replica side;
  - the days of master binlog retention left;
  - replica disk usage.
- **Incidents** go through the core:
  - P2 when replication stops, or lags more than 15 minutes for 15 minutes;
  - P2 when a filtered database is missing or its table counts differ;
  - P2 when the checksum finds a mismatch;
  - P3 when sizes differ by more than 2% for an hour;
  - P3 when the report is older than 5 minutes; it is shown as stale, never as healthy;
  - P1 when a stopped replica nears the end of master binlog retention.
- **No control.** The module has no start, stop, skip-error or switch-over control. For a new pair it generates the `CHANGE MASTER TO` commands for an administrator to copy and run after hospital approval. The password is a placeholder in those commands.
- **Layout.** The module opens on the side-by-side master | percentage | replica view (prototype layout 1). When more than one pair is configured, a pair list appears first (prototype layout 4).

## Consequences

- Each database host gets a small reporter process, which is a production change needing approval. On the GDCC replica it already exists as the ADR 0010 check.
- "Real time" means every 10 seconds for status and every 5 minutes for sizes. Polling `information_schema` for 6,000+ tables more often would load the production server.
- Failing over to a replica remains a separate decision and runbook (ADR 0010).
