# Operate the existing FortiSIEM in-house after INET service ends

- Status: Superseded by [0002](./0002-migrate-to-open-source-siem.md) and [0008](./0008-run-wazuh-on-a-dedicated-vm.md)
- Date: 2026-10-08

The hospital will retain and operate the existing FortiSIEM server itself after INET SIEM service ends, rather than replacing the SIEM immediately or retaining managed operation. This preserves existing detection and log history while requiring a complete SIEM Handover Package and verified handover before service transition.

## Considered Options

- Continue a managed SIEM service.
- Migrate to a new SIEM immediately.
- Operate the existing FortiSIEM server in-house.

## Consequences

The hospital assumes responsibility for operating-system maintenance, storage capacity, parsers, rules, backups, recovery, and upgrades. The Dashboard must connect through a least-privilege read-only integration and must not depend permanently on INET service access.
