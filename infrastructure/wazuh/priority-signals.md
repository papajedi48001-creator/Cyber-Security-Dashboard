# Sophos Priority Signals

Wazuh rules that turn Sophos SFOS events into the categories the Portal uses. Each alerting rule carries exactly one category group.

| Category (group) | Rule | Level | Matches | Notes |
|---|---|---:|---|---|
| `blocked_traffic` | 100110 | 5 | `log_type="Firewall"` and `log_subtype="Denied"` | High volume; the Portal summarises and only escalates by policy |
| `admin_or_login_failure` | 100120 | 8 | `log_type="Event"`, component GUI/CLI/Authentication/API/SSH/Console, `status="Failed"` | |
| `firewall_rule_change` | 100130 | 10 | `log_type="Event"`, `log_subtype="Admin"`, `status="Successful"`, message names a rule or policy being added/modified/deleted | Feeds Emergency Rule Change Evidence |
| `vpn_anomaly` | 100140 | 8 | `log_type="Event"`, VPN component (SSL VPN, IPSec, L2TP, PPTP, Sophos Connect), `status="Failed"` | |
| `ips_av_web_event` | 100150 | 10 | `log_type` IDP/Anti-Virus/Anti-Spam/Content Filtering/ATP/Sandstorm/Zero-day Protection with a drop/alert/virus/denied subtype | |
| `restricted_egress` | 100160 | 10 | `log_type="Firewall"`, `log_subtype="Allowed"`, destination port in the restricted outbound list, destination not a private address | Restricted Egress Violation (ADR 0007). Port list must match `RESTRICTED_EGRESS_PORTS` in the Portal; the Portal reads `port N/PROTO` from the description to apply expiring exceptions |
| `log_source_health` | 100181, 100182 | 9, 12 | TLS Log Relay health report `degraded`/`unknown` (100181) or `failed` (100182); `healthy` raises heartbeat 100183 (level 3, no category) | Absence of Sophos events is evaluated by the Portal from `expected_interval_minutes` in the inventory |

Rule 100100 (level 0) is the base for all SFOS events; normal allowed traffic and successful logins stop there and do not alert. They are still kept in `wazuh-archives-*` for forensic search.

## Fields extracted by the decoder

`log_type`, `log_component`, `log_subtype`, `status`, `srcip`, `dstip`, `dstport`, `protocol`, `srcuser`, `message`.

The Portal stores only the alert id, rule id, category, level, timestamps and an investigation link (ADR 0006). Executive views and notifications never show `srcip`, `dstip` or `srcuser`.

## Verifying on the real server

The decoder and rules were written against the documented SFOS key=value format with synthetic events (`tests/fixtures/sophos_events.json`). Before acceptance:

1. Capture a sample of real Sophos lines for each category (redact usernames and IPs before committing any as fixtures).
2. Install the files (see `docs/operations/wazuh-all-in-one-runbook.md`) and run `python3 logtest_check.py` on the Wazuh server.
3. Adjust decoders or rules until every case passes, then add the redacted real samples to the fixtures.
