# Organize the Portal as a core platform with modules

- Status: Proposed
- Date: 2026-11-24

On 2026-11-24 the hospital asked to treat the whole system as one product named **Waritchaphum Security Dashboard**. Cloud backup becomes one module of it, and all settings belong to the main system instead of to individual features. The hospital approved the clickable prototype the same day.

The Portal already has several separate pages: incidents, assets, log source health, backups, port monitoring, Cloudflare WAF, Duo, executive reporting and user administration. Each one carries its own connector settings, notification rules and access checks. Adding cloud backup and a database replica monitor the same way would spread settings across more pages.

## Considered Options

- **Keep adding independent pages.** Cheapest now. But every new page re-implements settings, permissions and stale-data handling.
- **Core platform with a module registry (chosen).**
- **Separate applications per area (for example a separate backup site).** This would mean more logins, more servers and more audit trails to keep consistent.

## Decision

- **Name.** Users see the product as "Waritchaphum Security Dashboard". In code and documents the application stays the Portal (the `CONTEXT.md` term), so no code or database rename is needed.
- **Core platform** owns everything shared, under "ตั้งค่าระบบ" (System Settings):
  - Modules: turn them on or off.
  - Sign-in: covered by ADR 0012.
  - Users, roles and per-module permissions.
  - Notification channels (email and LINE).
  - Connectors and their credentials.
  - The audit log.

  Only a Security Administrator sees System Settings.
- **Module.** A module is a feature area that declares four things:
  - an id and a name;
  - the connectors it needs;
  - the permission it grants each role, one of: none, view, act, manage;
  - a status summary for the overview page: a health value, a headline and a detail line.

  A module may keep module-specific thresholds. It never stores credentials or notification recipients of its own; it asks the core for them by name.
- **Core modules** cannot be turned off because other modules depend on them: Security Incidents, Asset Register and Executive Reporting.
- **Optional modules:**
  - Log Source Health, External Port Exposure, Cloudflare WAF and Duo Manual Check (existing);
  - Cloud Backup (ADR 0009);
  - MariaDB Replica (ADR 0013);
  - proposed for later approval: Vulnerability and Patch, Configuration Compliance (Wazuh SCA), and Certificate and Domain Expiry.
- **Turning a module off** removes it from navigation, the overview, reports and notifications, and stops its connector polling. It keeps the module's stored records, and turning it on again resumes from the last checkpoint.
- **Overview.** The home page shows one tile per enabled module that the user may view. A module with missing or stale data shows "ข้อมูลเก่า" or "รอข้อมูล", never a healthy state or zero.
- **Every module raises incidents through the core** Security Incidents module, and notifications through the core channels.

## Consequences

- Existing pages move under the module registry. Their URLs can stay, and each gains a registry entry and a permission check through one shared helper.
- A new table stores module enablement, and the audit log records every change to it.
- Connector credentials move from environment-only configuration to encrypted records managed in System Settings. Environment variables remain the bootstrap for the first administrator and for the encryption key itself (ADR 0012).
- The three existing roles stay. Per-module permissions are a fixed matrix in code, reviewed at UAT. They are not a free-form editor, which keeps role separation testable.
- The proposed modules (Vulnerability and Patch, Configuration Compliance, Certificate and Domain Expiry) each need their own plan and approval before they are built.
