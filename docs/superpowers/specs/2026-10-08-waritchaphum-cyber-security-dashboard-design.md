# Cyber Security Operations Dashboard — Hospital Waritchaphum

## Purpose

Create a daily security-operations capability for Hospital Waritchaphum. The system gives the IT team one controlled workspace for monitoring, triage, incident handling, audit evidence, backup evidence, and executive reporting without treating it as a full SOC. It preserves the existing FortiSIEM during transition, then establishes an in-house open-source SIEM independent of INET service.

## Confirmed goals

- Make the Security Operations Portal the daily operations workspace for the hospital IT team.
- Keep Wazuh as the raw-log and forensic-investigation system.
- Ingest Sophos Firewall security data through encrypted Syslog.
- Cover SIEM, Log Source Health, Cloudflare Free WAF summaries, Duo monitoring, GDCC backup evidence, future EDR, and port monitoring.
- Start with Sophos and critical assets, then expand to all servers and network devices.
- Support P1 notifications 24x7; handle P2–P4 during working hours according to the approved SLA.
- Retain queryable hot logs for 90 days and encrypted archives for one year.
- Keep patient data out of the system and minimize personal data in operational views.

## Scope and non-goals

The initial scope includes a separate Portal, a Portal database, a TLS Log Relay, Wazuh all-in-one, and read-only integrations. It does not introduce high availability, automatic restoration into production systems, patient-data storage, internet-public Portal access, raw-log duplication in the Portal, or a permanent Duo API connector before API entitlement is confirmed.

## Architecture

```text
Sophos Firewall -- TLS Syslog --> Log Relay --> Wazuh All-in-One
                                                |\
                                                | \-- forensic investigation and raw logs
                                                |
                                                \---- read-only alert integration
                                                           |
Cloudflare Free / Duo / GDCC Backup -----------------------+
                                                           v
                                             Security Operations Portal
                                             - incident workflow and audit trail
                                             - asset and source health
                                             - port exposure and egress violations
                                             - backup evidence and future lifecycle requests
                                             - Cloudflare and Duo summaries
                                             - executive summary
                                                           |
                                                           v
                                            Portal MariaDB (separate service)
```

### Components

| Component | Responsibility | Boundary |
|---|---|---|
| Sophos Firewall | Generates traffic, security, administrator, VPN, IPS/AV, and web-protection events | Does not decide incidents in the Portal |
| TLS Log Relay | Authenticates allowed sources, terminates or preserves TLS as designed, buffers events, and forwards to Wazuh | Does not analyze, store long-term, or close incidents |
| Wazuh all-in-one | Parses and detects security signals, stores raw/security data, supports forensic investigation | Does not own hospital incident workflow or backup-file lifecycle |
| Security Operations Portal | Owns operations workflow, incident records, audit evidence, cross-service summaries, notification delivery state, and executive reporting | Does not store a second raw-log repository |
| Portal MariaDB | Stores Portal-only operational records | Is separate from HOSxP and Wazuh Indexer |
| GDCC | Receives encrypted backup artifacts | Does not host production Portal or SIEM runtime in this phase |

## Network and access controls

- All Portal and Wazuh access is limited to the Management VLAN or a VPN that enforces MFA.
- The Portal Application Server is a separate VM or server from the Wazuh all-in-one host.
- Sophos sends TLS Syslog only to the Log Relay; the relay allowlists authorized source addresses and retains a bounded buffer for Wazuh maintenance or outage.
- Portal connectors use dedicated read-only service accounts. Credentials are stored in a secrets mechanism, are rotatable, and are never embedded in source code, export files, URLs, or notifications.
- The Portal begins with local accounts and MFA for Security Administrators and Security Operators. It has a defined identity transition to AD/LDAP once stable.
- Executive Viewer is read-only and sees a redacted summary with no internal IP addresses, usernames, raw logs, detailed vulnerabilities, or patient data.

## Data policy and retention

- Operational Security Data contains only technical information necessary to operate and investigate security events. Patient data is not collected or displayed.
- Hot Log is queryable in Wazuh for 90 days.
- Log Archive is encrypted and retained for one year.
- The Portal stores only incidents, asset metadata, audit evidence, integration state, and summarized operational data. It never replicates raw Wazuh events as a long-term log store.
- Backup Job Success means that a backup job completed according to the backup system; it does not prove restorability. Until a restore test is available, the Portal marks recovery verification as unconfirmed.

## Detection and monitoring scope

### Sophos Priority Signals

The first detection set covers blocked traffic, administrator and login failures, configuration or firewall-rule changes, abnormal VPN activity, IPS/AV/web-protection events, and Log Source Health. Detection starts with critical assets: HOSxP-related servers, database services, backup services, domain controllers, and the Sophos Firewall. Expansion to all servers and network devices follows measured capacity validation.

### Blacklist port monitoring

The Portal keeps two separate control families:

1. External Port Exposure identifies internal services reachable from the internet, including risky ports such as SSH, RDP, database services, and any service not explicitly approved.
2. Restricted Egress Violation identifies internal systems that initiate traffic to prohibited ports or destinations.

Each finding has independent rules, severity, allowlists, evidence, owner, and closure criteria.

### Cloudflare Free WAF

Cloudflare Free data is summarized as sampled WAF events: trend, block/challenge action, top paths, countries, and sources. Every WAF view labels this limitation; it is not presented as a complete raw-request evidence store.

### Duo

The initial Portal records connector readiness and a structured Duo Manual Check based on the Duo Admin Panel. A read-only API connector may be enabled only after the hospital confirms a compatible Duo entitlement and creates a restricted service account.

### Future EDR

The Portal uses an EDR Adapter boundary with common fields for device health, detection, severity, isolation state, and agent health. The design does not lock the hospital to a specific EDR supplier.

## Incident workflow

```text
Security Event -> assessment and severity -> Security Incident
  -> Assigned -> Acknowledged -> Investigating -> Mitigated
  -> Pending Review for P1/P2 -> Closed
```

- P1 and P2 require Closure Evidence plus review by a separate Incident Reviewer.
- P3 and P4 require recorded cause, remediation, closer, and time.
- The Portal audit trail captures every state change, ownership change, severity change, notification attempt, approval, connector action, and configuration change.
- Emergency Rule Changes may happen immediately, but must record the operator, time, reason, before and after rule values, and a post-change verification result.

### SLA

| Severity | Initial handling | Acknowledge target | Review before closure |
|---|---|---:|---|
| P1 Critical | 24x7 notification | 15 minutes | Required |
| P2 High | 24x7 notification | 1 hour | Required |
| P3 Medium | Working hours | 4 working hours | Not required |
| P4 Low | Working hours | Next working day | Not required |

### Notifications

Email and LINE OA receive only a Notification Summary: severity, incident number, detection time, affected system name, and Portal link. No raw logs, internal IP addresses, usernames, detailed vulnerabilities, or patient data are sent through LINE. Delivery failures are recorded in the Portal and follow escalation rules.

## Backup and disaster recovery

### Initial monitoring

The Portal reads backup evidence: latest success/failure, success timestamp, data age, size, GDCC destination, consecutive failures, encryption status, retention date, and recovery-verification status. Monitoring is read-only; it cannot invoke backup or restore operations.

### Future file lifecycle management

Future Backup File Management supports requests to find, archive, retain, and destroy backup files. A Backup Lifecycle Request requires a Backup Operator proposal, Security Administrator approval, a Backup Deletion Hold, execution evidence, and an audit trail. The Portal never provides an immediate-delete operation or a production restore operation.

All backup artifacts are encrypted before GDCC storage where the backup system supports it. Encryption-key recovery uses a Secrets Vault with Dual-Control Key Recovery by at least two responsible people.

### Recovery objectives

Wazuh all-in-one and required Portal components must be recoverable within 24 hours. This phase accepts a gap in log collection during recovery and is not high availability.

## Roles

| Role | Capabilities |
|---|---|
| Security Administrator | Configures Portal, connectors, users, policies, and approvals; accesses sensitive operational views with MFA |
| Security Operator | Triage, owns, investigates, mitigates, and records incidents with MFA |
| Executive Viewer | Reads redacted executive reporting only |

Shared SIEM Operations means the hospital IT team shares Wazuh operations. Despite no single SIEM owner, named accounts and complete access/change audit records remain mandatory.

## Migration from FortiSIEM

1. Obtain the SIEM Handover Package from INET: credentials, topology, inventory, VM/storage details, sources, rules/parsers/reports, backup and restore runbooks, upgrade instructions, and prior evidence.
2. Execute the SIEM Handover Acceptance Test: login, Sophos ingestion, representative detection, read-only Dashboard integration, backup/restore, and notifications.
3. Preserve required reports and evidence. Retain FortiSIEM as a Legacy SIEM Evidence Store in read-only state for the approved retention period.
4. Measure existing hardware CPU, RAM, disk, available storage, real Sophos event volume, Log Relay throughput, and network/certificate requirements.
5. Build the independent Wazuh all-in-one, TLS Log Relay, Portal Application Server, and dedicated Portal MariaDB service.
6. Run a parallel validation only on separate temporary capacity; do not run old and new SIEM production workloads together on the same host without evidence of sufficient capacity.
7. Compare log arrival, critical detections, alert quality, source health, and notification outcomes.
8. Cut Sophos over to the new TLS Log Relay after acceptance. Stabilize with capacity and alert-quality monitoring.
9. Decommission FortiSIEM only after the evidence-retention period ends and formal approval confirms no legal, operational, or investigation hold remains.

## Cutover acceptance criteria

- Sophos TLS Syslog reaches the Log Relay and Wazuh consistently.
- Wazuh detects agreed Sophos Priority Signals.
- Source Health identifies a missing source according to defined thresholds.
- Portal consumes Wazuh alert summaries through read-only access and creates an auditable incident.
- Email and LINE OA deliver redacted Notification Summaries.
- Wazuh and Portal encrypted backups have a documented recovery procedure consistent with the 24-hour objective.
- Wazuh reports no dropped events during validated load.
- Access, role separation, MFA, audit records, and network restrictions are verified.

## Delivery phases

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | FortiSIEM handover assessment and hardware/EPS evidence | Hospital accepts handover findings |
| 1 | TLS Log Relay, Wazuh all-in-one, Sophos priority detection, source health | Measured ingestion and detection acceptance |
| 2 | Portal, MariaDB, roles/MFA, incident workflow, email/LINE notifications | UAT of P1–P4 workflow and audit trail |
| 3 | Backup Evidence, port monitoring, Cloudflare sampled WAF, Duo Manual Check, executive reporting | Module UAT and redaction review |
| 4 | AD/LDAP, Duo API when entitled, EDR Adapter, Backup File Management | Separate approval per capability |

## Verification approach

- Unit tests cover Portal workflow transitions, authorization, redaction, audit creation, severity/SLA calculation, and notification payload construction.
- Integration tests cover Wazuh alert ingestion, Log Relay health, MariaDB persistence, and simulated email/LINE failures.
- UAT uses synthetic security events and test assets; no patient records are used.
- A cutover rehearsal proves Sophos logging, source health, critical detection, incident handling, notification delivery, and recovery documentation before production cutover.
