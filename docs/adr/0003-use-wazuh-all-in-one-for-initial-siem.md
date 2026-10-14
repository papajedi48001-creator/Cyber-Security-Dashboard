# Use Wazuh all-in-one for the initial open source SIEM

- Status: Accepted
- Date: 2026-10-08

The initial open source SIEM will deploy Wazuh server, indexer, and dashboard together on the existing server hardware. This matches the initial scope of Sophos and critical assets while preserving a path to separate components when verified event volume or resource use requires it.

## Consequences

The deployment is not high availability and requires monitored capacity, tested backup and restore, and a documented scale-out threshold. Production installation is contingent on measured hardware capacity and estimated event volume.
