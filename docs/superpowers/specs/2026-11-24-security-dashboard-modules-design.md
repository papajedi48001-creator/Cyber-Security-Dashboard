# Waritchaphum Security Dashboard: core platform, modules and MariaDB Replica

- Date: 2026-11-24
- Decisions: [ADR 0011](../../adr/0011-core-platform-with-modules.md), [ADR 0012](../../adr/0012-sign-in-with-provider-id-and-thaid.md), [ADR 0013](../../adr/0013-mariadb-replica-monitoring-module.md)
- Builds on: [the system design](./2026-10-08-waritchaphum-cyber-security-dashboard-design.md), [the cloud backup design](./2026-11-10-cloud-backup-design.md), [ADR 0010](../../adr/0010-hos-database-replica-on-gdcc.md)

## Intent

The hospital wants one product, the **Waritchaphum Security Dashboard**, with these properties:

- shared settings in one place;
- cloud backup as one module among several;
- sign-in through Provider ID or ThaID, with the Client ID and secret entered by an administrator;
- a module that shows how closely each MariaDB replica follows its master.

The hospital approved a clickable prototype on 2026-11-24. This spec turns that prototype into requirements.

## Information architecture

```
ภาพรวม (overview: one tile per enabled module)
โมดูล
  เหตุการณ์ความปลอดภัย      core
  ทะเบียนทรัพย์สิน          core
  สุขภาพแหล่ง Log
  Cloud Backup
  MariaDB Replica
  พอร์ตเปิดสู่ภายนอก
  Cloudflare WAF
  Duo MFA
  รายงานผู้บริหาร           core
  (proposed) ช่องโหว่และแพตช์ · ตรวจการตั้งค่าตามมาตรฐาน · ใบรับรองและโดเมน
ตั้งค่าระบบ (Security Administrator only)
  โมดูล · การเข้าสู่ระบบ · ผู้ใช้และสิทธิ์ · การแจ้งเตือน · การเชื่อมต่อ · บันทึกการใช้งาน
```

On a phone, the left rail becomes a horizontal strip.

## Module contract

Each module registers an entry with these fields:

| Field | Meaning |
|---|---|
| `id` | Stable key, for example `cloud-backup`, `db-replica` |
| `name` | Thai display name |
| `core` | `true` for modules that cannot be disabled |
| `connectors` | Names of core connectors it reads, for example `wazuh-indexer`, `gdcc-backup`, `db-replica-reporter` |
| `permissions` | For each role: `none`, `view`, `act` or `manage` |
| `summary()` | Returns `{ health: ok, warn, bad, stale or waiting; headline; detail; asOf }` for the overview tile |

A module calls `raiseIncident(...)` and `notify(...)` from the core. It never reads environment variables for credentials.

## Permission matrix

| Module | Security Administrator | Security Operator | Executive Viewer |
|---|---|---|---|
| Security Incidents | manage | act | view (summary) |
| Asset Register | manage | act | none |
| Log Source Health, Port Exposure, Cloudflare WAF, Duo | manage | act | none |
| Cloud Backup | manage | view | view |
| MariaDB Replica | manage | view | none |
| Executive Reporting | manage | view | view |
| System Settings | manage | none | none |

The hospital confirms this matrix at UAT.

## System Settings

- **Modules:** turn each module on or off. Core modules are locked. Every change is audited.
- **Sign-in (ADR 0012):**
  - one tab each for Provider ID and ThaID, holding the Client ID, a write-only Client secret, the redirect URI (read-only, with a copy button), endpoints, scopes, and an hcode for Provider ID;
  - a "Test connection" button;
  - a pre-enable checklist and a preview of the saved values, with the secret masked;
  - the status of the break-glass account.
- **Users and permissions:** a single allow-list. Each entry holds a name, a provider, a role and the last sign-in. The permission matrix is shown read-only.
- **Notifications:** email and LINE channels, each with an on/off switch, levels sent and a test message. The preview shows Notification Summary fields only.
- **Connectors:** name, target, scope (always read-only), the modules using it, status with last success, and a test button. Secrets are write-only.
- **Audit log:** append-only, covering sign-ins, refused sign-ins, setting changes and module actions.

## MariaDB Replica module (ADR 0013)

**Tabs:** ภาพรวม, ตั้งค่าคู่ server (Security Administrator only) and เกณฑ์แจ้งเตือน.

**Overview, single pair.** This is prototype layout 1:

- a master card: host, location, version, replicated size, GTID and binlog retention;
- a live percentage ring showing replica ÷ master over the filtered databases, with the label "realtime";
- a replica card: host, version, replicated size, executed GTID and read-only state;
- a status card: IO and SQL thread, lag, transactions behind, last error, and a 3-minute lag sparkline;
- an extras card: last checksum run, days of binlog left, replica disk use, and the warning that a replica is not a backup;
- the database comparison table: name, master size, replica size, %, tables M/R and state. A toggle shows system databases.

**Overview, several pairs.** This is prototype layout 4: pair cards come first, showing the flow, a percentage ring, lag and matching databases. Selecting a card shows its detail below.

**Server pairs tab:**

- a form with these fields:
  - name;
  - master host and port;
  - replica host and port;
  - the path from replica to master (internal network or SSH tunnel);
  - the replication filter;
  - the collection method (reporter recommended);
  - the reporter account and a write-only password;
  - TLS required.
- a test button. It checks the format of the values here; the real test also checks versions, distinct `server_id`, ROW binlog and the account's grants.
- the grants the account needs (`BINLOG MONITOR, SLAVE MONITOR`, no `SELECT`).
- generated replica set-up commands to copy. The Portal never runs them.

**Report `db-replica-report/v1`:**

```json
{
  "format": "db-replica-report/v1",
  "pair": "hos-gdcc",
  "side": "replica",
  "generated_at": "2026-11-24T02:30:10Z",
  "replication": {
    "io_running": true,
    "sql_running": true,
    "seconds_behind_master": 4,
    "gtid_io_pos": "0-1-48214291",
    "gtid_slave_pos": "0-1-48212616",
    "last_errno": 0,
    "last_error": ""
  },
  "databases": [
    { "name": "hos", "bytes": 235512000000, "tables": 6512 }
  ],
  "disk": { "used_bytes": 260000000000, "total_bytes": 500000000000 },
  "checksum": { "finished_at": "2026-11-23T19:00:00Z", "tables": 6512, "mismatched": 0, "skipped": 2 }
}
```

- The master side sends the same format with `side: "master"`, `gtid_binlog_pos`, the binlog retention, and no `replication` block.
- `databases` covers every schema with its byte size and table count, and nothing else.
- `last_error` is truncated to 500 characters, and quoted values are replaced with `?` before the report is written. This keeps row data out of the Portal even when an error message quotes a key value.

**Rendering rules:**

- A report older than 5 minutes shows "ข้อมูลเก่า" and the time of the last report.
- A pair with no report yet shows "รอข้อมูล".
- Neither state shows 0% or healthy.
- Lag is "ไม่ทราบ" when the SQL thread is stopped.

## Errors and edge cases

- A database present on the master and matching the filter but absent on the replica is shown as "ไม่มีบน replica" and raises P2.
- A database outside the filter is shown as "ไม่ทำสำเนา (ตามตัวกรอง)", not as an error.
- MEMORY tables are empty after a replica restart. The checksum skips them deliberately and reports them as `skipped`.
- Disabling the module stops polling and alerting; it keeps stored reports and history.

## Testing

- Unit tests:
  - module registry: the enablement rules, the core lock, and permission lookup per role;
  - sign-in: allow-list matching, hcode rejection, the hashed ThaID identifier, secret masking, and the rule that the last enabled method cannot be disabled;
  - replica report parsing and its state rules;
  - incident thresholds;
  - stale rendering.
- Integration tests run against a mocked OIDC provider (no real Provider ID or ThaID in CI) and use synthetic replica reports.
- Playwright covers four things:
  - navigation by role;
  - System Settings, administrator only;
  - entering a provider secret, which is then not shown again;
  - the replica overview in its single-pair and multi-pair states.

## Hospital confirmations

1. Register the application with Provider ID and with ThaID, and supply the Client IDs, secrets and endpoints.
2. Confirm that each provider's sign-in meets the MFA requirement, or that the Portal adds its own TOTP step.
3. Confirm the permission matrix.
4. Approve the Replica Reporter on each database host, and the reporter account's grants.
5. Decide whether to build the proposed modules: Vulnerability and Patch, Configuration Compliance, and Certificate and Domain Expiry.
