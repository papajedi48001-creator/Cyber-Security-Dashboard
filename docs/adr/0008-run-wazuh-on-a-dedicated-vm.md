# Run Wazuh on a dedicated new VM and leave FortiSIEM untouched

- Status: Accepted
- Date: 2026-10-14
- Supersedes: [0005](./0005-run-wazuh-in-place-on-existing-siem-server.md)

Wazuh all-in-one will run on a new virtual machine created only for Wazuh. The project does not stop, change, export from, or rebuild FortiSIEM or the Existing SIEM Server. The hospital decided this on 2026-10-14.

Sophos keeps its current Syslog destination for FortiSIEM unchanged and adds a second destination: TLS Syslog to the TLS Log Relay, which forwards to Wazuh. Both SIEMs therefore receive Sophos events during validation (a parallel run). Wazuh becomes the production SIEM when the hospital accepts it; what happens to FortiSIEM afterwards is a separate hospital decision outside this project.

## Considered Options

- Export FortiSIEM evidence, then rebuild the existing server as Wazuh all-in-one (ADR 0005).
- Run Wazuh on a dedicated new VM and leave FortiSIEM running as it is.

## Consequences

- No FortiSIEM evidence export, image or image-restore test is needed before Wazuh is installed. The Legacy SIEM Evidence Store applies only if the hospital later retires FortiSIEM.
- There is no planned logging gap: FortiSIEM keeps receiving Sophos events while Wazuh is installed and validated. Rollback is removing the second Sophos destination; FortiSIEM is unaffected either way.
- The hypervisor must have capacity for the new VM that meets the Wazuh all-in-one minimum for 90 days of hot logs (measured in the capacity baseline). If it does not, the hospital must add capacity before installation.
- Adding the second Sophos Syslog destination is a production change that needs hospital approval. The capacity baseline must confirm that Sophos supports the extra destination and that the added sending load is acceptable.
- Sophos event volume is measured from the firewall or from FortiSIEM read-only views; the project does not change FortiSIEM to obtain it.
- The TLS Log Relay and the Security Operations Portal stay off the Wazuh VM (ADR 0004), so the relay can buffer while Wazuh is down.
