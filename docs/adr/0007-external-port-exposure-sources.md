# Detect External Port Exposure from scans and firewall configuration

- Status: Accepted
- Date: 2026-10-14

External Port Exposure is determined from two sources outside the log stream: a scheduled scan of the hospital's public IP addresses from outside the network, and the Sophos Firewall NAT and WAN-facing rule configuration. Sophos traffic logs alone show attempted connections, not whether a service is actually reachable.

## Considered Options

- Infer exposure from Sophos logs only.
- Scheduled external scan only.
- External scan plus Sophos rule configuration compared with an approved-exposure allowlist.

## Consequences

- The scanner runs from a host outside the hospital network, scans only hospital-owned public addresses on an approved schedule, and sends results to the Portal as a summary (address, port, service, first and last seen).
- The Portal compares scan results and Sophos rules with the approved-exposure allowlist; each allowlist entry has an owner and an expiry date.
- Restricted Egress Violation is still detected from Sophos logs through Wazuh, because it is about connections that actually happened.
- A failed or missing scan is shown as stale data, not as "no exposure".
