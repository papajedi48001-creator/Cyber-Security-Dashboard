# Security Operations Delivery Roadmap

This roadmap decomposes the approved design into independently reviewable implementation plans. Execution must follow plan order; a later plan may not bypass the acceptance gate of an earlier plan.

| Order | Plan | Outcome | Approval gate |
|---:|---|---|---|
| 1 | [Foundation and SIEM Migration](./2026-10-08-siem-foundation-and-migration.md) | Evidence-backed FortiSIEM handover, TLS Log Relay, Wazuh all-in-one, and tested cutover | Hospital approves handover, measured capacity, and cutover rehearsal |
| 2 | [Security Operations Portal Core](./2026-10-08-security-operations-portal-core.md) | Restricted Portal with local MFA, roles, assets, incident workflow, audit trail, and Wazuh read-only ingestion | UAT approves role separation, incident workflow, redaction, and audit evidence |
| 3 | [Operational Integrations](./2026-10-08-security-operations-integrations.md) | Backup Evidence, port monitoring, Cloudflare sampled WAF, Duo Manual Check, notifications, and executive reporting | Module UAT confirms data boundaries, notifications, and operational runbooks |

Deferred capabilities are separate changes requiring separate approval: AD/LDAP identity, Duo API connector after entitlement confirmation, EDR Adapter, Backup File Management, and Wazuh scale-out/high availability.

