# Core Platform, Provider Sign-in and MariaDB Replica Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present the Portal as the Waritchaphum Security Dashboard with these parts:

- a module registry;
- System Settings owned by the core;
- sign-in through Provider ID and ThaID with a break-glass local account;
- a read-only MariaDB Replica module.

**Architecture:**

- **Module registry.** A typed module registry in `portal/src/lib/modules/` drives navigation, the overview tiles and permission checks.
- **Shared records.** Connector credentials and identity-provider settings move into encrypted Prisma records, edited in System Settings.
- **OIDC.** An OIDC client in `portal/src/lib/auth/oidc/` handles both providers against an allow-list.
- **Replica reports.** Replica Reporters write `db-replica-report/v1` files. The worker pulls them, the same way as the cloud backup reports, into new tables that the module renders.

**Tech Stack:**

- Portal: Next.js 15, Prisma 6, MariaDB, Vitest and Playwright.
- OIDC client: Node `crypto` for PKCE and HMAC, plus a maintained OIDC client library chosen in Task 3.
- Replica Reporter: Python 3 standard library plus the `mariadb` client CLI.

**Spec:** `docs/superpowers/specs/2026-11-24-security-dashboard-modules-design.md`

## Global Constraints

- **Names.** The display name is "Waritchaphum Security Dashboard". Code, routes and the glossary keep "Portal".
- **Secrets.**
  - Client secrets and connector passwords are encrypted with `SETTINGS_ENCRYPTION_KEY` from the environment.
  - The interface never returns them; responses carry `secretSet: boolean` and `secretUpdatedAt`.
  - Audit entries record that a secret changed, never the value.
- **ThaID identifiers** are stored only as `HMAC-SHA256(IDENTITY_HASH_KEY, pid)`. The raw citizen ID never reaches logs, the database or test fixtures. Tests use synthetic 13-digit values.
- **Fixed roles.** The three existing roles stay, and the permission matrix is a constant in code.
- **No new controls.** The Portal gains no restore, backup-run, delete, replication start/stop or switch-over control.
- **No real data in git.** No real endpoints, Client IDs, hostnames or IP addresses. Commit `*.example` files only.
- **Missing data.** Stale or missing data renders as "ข้อมูลเก่า" or "รอข้อมูล", never as zero or healthy.
- **Times.** Times are stored in UTC and rendered in Asia/Bangkok.

### Task 0: Hospital readiness record

- [ ] Record the following in `docs/operations/` (Thai):
  - the Provider ID and ThaID application registrations;
  - each provider's endpoints and claims, as documented by the provider;
  - the MFA confirmation for each provider;
  - the permission matrix sign-off;
  - approval of the Replica Reporter and its account grants.

  Implementation of Tasks 3 and 7 waits for the matching entries.

### Task 1: Module registry and navigation

**Files:** `portal/src/lib/modules/registry.ts`, `registry.test.ts`, `portal/src/app/(app)/layout.tsx`, `prisma/schema.prisma` (`ModuleSetting { id, enabled, updatedAt, updatedBy }`).

- [x] Write failing tests:
  - every existing page is registered;
  - core modules cannot be disabled;
  - `visibleModules(role, settings)` follows the permission matrix in the spec;
  - a disabled module is hidden and its connector is not polled.
- [x] Run `npm test -- registry`. Expect FAIL.
- [x] Implement the registry, the migration and the left-rail layout with the "ตั้งค่าระบบ" group shown to administrators only.
- [x] Run the tests. Expect PASS. Commit.

### Task 2: Encrypted settings store and connectors page

**Files:** `portal/src/lib/settings/secrets.ts` (+ test), `portal/src/lib/settings/connectors.ts` (+ test), `portal/src/app/(app)/settings/connectors/page.tsx`.

- [x] Write failing tests:
  - encryption round-trips;
  - decryption fails with the wrong key;
  - API serialisation never contains the secret, only `secretSet`;
  - a secret change writes an audit entry without the value;
  - the environment values are used once as the bootstrap when no record exists.
- [x] Implement, migrate the existing connectors (Wazuh Indexer, Cloudflare, scanner, GDCC reports) and add the connectors page with its test buttons.
- [x] Run the tests. Expect PASS. Commit.

### Task 3: Provider ID and ThaID sign-in

**Files:** `portal/src/lib/auth/oidc/` (`config.ts`, `flow.ts`, `identity.ts` + tests), `portal/src/app/auth/callback/[provider]/route.ts`, `portal/src/app/(app)/settings/login/page.tsx`, `prisma/schema.prisma` (`IdentityProvider`, `UserIdentity { userId, provider, subjectHash }`).

- [ ] Write failing tests against a mocked provider:
  - `state` mismatch is rejected;
  - the PKCE verifier is required;
  - an unknown identity is refused and audited;
  - a Provider ID identity outside the allowed hcode is refused;
  - a ThaID identity matches only by HMAC;
  - the last enabled sign-in method cannot be disabled;
  - a provider cannot be enabled until its checklist passes.
- [ ] Implement the flow, the settings page (tabs, write-only secret, copyable redirect URI, test connection, checklist and preview) and the login page with both providers plus the break-glass form.
- [ ] Break-glass sign-in notifies all Security Administrators. Add a test for that.
- [ ] Run unit tests and Playwright `e2e/login-providers.spec.ts` against the mock provider. Expect PASS. Commit.

### Task 4: Users, notifications and audit pages under System Settings

- [x] Write failing tests:
  - adding a user requires a provider and a role;
  - only administrators reach `/settings/*` (otherwise 403);
  - the audit page is read-only.
- [x] Move `admin/users` to `settings/users`, keeping a redirect. Add the notifications page using the existing channels with a test-send, and the audit log page.
- [x] Run the tests. Expect PASS. Commit.

### Task 5: Overview tiles from module summaries

- [x] Write failing tests:
  - every visible module contributes one tile;
  - a module whose summary is older than its stale threshold renders `stale`;
  - a module with no data renders `waiting`.
- [x] Implement `summary()` for each existing module, plus the overview page.
- [x] Run the tests. Expect PASS. Commit.

### Task 6: Replica report model and ingestion

**Files:** `portal/src/lib/replica/report.ts` (+ test), `portal/src/lib/replica/state.ts` (+ test), `portal/src/lib/worker/replica-sync.ts`, `prisma/schema.prisma` (`ReplicaPair`, `ReplicaStatus`, `ReplicaDatabaseSize`).

- [ ] Write failing tests with synthetic reports:
  - parse `db-replica-report/v1` and reject other formats;
  - the volume % is computed over filter-matching databases only;
  - database states are matching, missing, tables missing, size differs, filtered or system;
  - incident rules map to P1, P2 and P3 as in ADR 0013;
  - a report older than 5 minutes renders stale;
  - lag is unknown when SQL is stopped;
  - `last_error` arrives already redacted and is truncated to 500 characters.
- [ ] Implement parsing, the state rules, the worker sync (status every 10 s, sizes every 5 min) and incident raising through the core.
- [ ] Run the tests. Expect PASS. Commit.

### Task 7: Replica Reporter

**Files:** `infrastructure/db-replica-reporter/reporter.py` (+ `test_reporter.py`), `reporter.example.toml`, `db-replica-reporter.service.example`, `db-replica-reporter.timer.example`.

- [ ] Write failing tests:
  - parse `SHOW SLAVE STATUS` output fixtures;
  - sum per-database directory sizes from a synthetic data directory;
  - redact quoted values in `Last_SQL_Error`;
  - write the report atomically;
  - never call `SELECT` on a user schema.
- [ ] Implement the reporter and the push into the same report path as the cloud backup reports.
- [ ] Run `python3 -m unittest`. Expect PASS. Commit.

### Task 8: MariaDB Replica module pages

- [ ] Write failing tests:
  - single-pair layout: master card, % ring, replica card, status, extras and database table;
  - the pair list appears when more than one pair exists;
  - the server-pairs tab is administrator only, the password is write-only, and the generated commands contain a password placeholder;
  - no start, stop or switch control exists in the rendered page.
- [ ] Implement the pages to match the approved prototype (layouts 1 and 4).
- [ ] Run the unit tests and Playwright `e2e/replica.spec.ts` with synthetic reports. Expect PASS. Commit.

### Task 9: Glossary, runbooks and roadmap

- [ ] Write Thai runbooks:
  - registering with Provider ID and ThaID;
  - break-glass use;
  - installing the Replica Reporter;
  - responding to replica incidents.
- [ ] Confirm that the `CONTEXT.md` terms match the implementation. Commit.

### Task 10: UAT (hospital-approved, outside git)

- [ ] Real sign-in through both providers.
- [ ] Refusal of a user who is not on the allow-list.
- [ ] Break-glass alert.
- [ ] Replica overview against the GDCC `hos` replica.
- [ ] A planned replica stop raises P2, and recovery closes it with evidence.
