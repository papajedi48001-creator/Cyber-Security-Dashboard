# Run Wazuh in place on the existing SIEM server

- Status: Accepted (FortiSIEM evidence handling pending hospital confirmation)
- Date: 2026-10-14

Wazuh all-in-one will be installed on the existing FortiSIEM server hardware, replacing FortiSIEM on that machine, instead of being validated on separate temporary capacity first. The hospital has no separate validation hardware, and the existing server is the capacity it already owns.

Before the server is rebuilt, the hospital exports the FortiSIEM evidence it must keep (reports, rules, parsers, configuration, and logs inside the required retention window) and takes a full FortiSIEM image or backup to encrypted storage outside the server. That export becomes the Legacy SIEM Evidence Store; FortiSIEM no longer runs.

## Considered Options

- Validate Wazuh on separate temporary capacity, then cut over (original plan).
- Run Wazuh as a VM beside FortiSIEM on the same host, if the host is a hypervisor with measured spare capacity.
- Export FortiSIEM evidence, then rebuild the existing server as Wazuh all-in-one.

## Consequences

- There is no parallel run of old and new SIEM. Validation happens on the rebuilt server with synthetic events before Sophos is switched over, and the rollback path is restoring the FortiSIEM image.
- Logging is interrupted between FortiSIEM shutdown and Wazuh acceptance. The TLS Log Relay must be in place first so it can buffer Sophos events during the rebuild, and the gap must be recorded.
- Hardware capacity (CPU, RAM, disk, EPS) must be measured before the rebuild and must meet the Wazuh all-in-one minimum for 90 days of hot logs; otherwise the hospital must add disk or RAM first.
- The TLS Log Relay and the Security Operations Portal stay off the Wazuh host (ADR 0004), so the relay can still buffer while Wazuh is down.
