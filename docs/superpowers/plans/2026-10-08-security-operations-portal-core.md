# Security Operations Portal Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the restricted hospital Portal for role-controlled incident operations, audit evidence, asset inventory, read-only Wazuh alert intake, and P1/P2 notifications.

**Architecture:** A TypeScript Next.js Portal runs separately from Wazuh and persists operational records in a dedicated MariaDB database. Wazuh remains the forensic source; the Portal pulls alert summaries from the Wazuh Indexer on a schedule (ADR 0006) and stores alert references and normalized incident records only.

**Tech Stack:** Node.js LTS; Next.js App Router; TypeScript; MariaDB; Prisma ORM; Argon2 password hashing; TOTP MFA; signed secure session cookies; SMTP; LINE Messaging API; Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-waritchaphum-cyber-security-dashboard-design.md`

## Global Constraints

- Deploy only on a Portal Application Server separate from Wazuh and HOSxP.
- Permit access only from Management VLAN or MFA-protected VPN.
- Implement Security Administrator, Security Operator, and Executive Viewer roles.
- MFA is mandatory for Administrator and Operator accounts.
- Never persist patient data or duplicate raw Wazuh logs.
- Store all times in UTC and render Asia/Bangkok time in user views.
- All Portal mutations create immutable audit records.
- LINE and email send only Notification Summary fields.

## Review Focus

- Unauthorized role changes, incident access, and exports must fail without revealing protected records.
- Executive pages must redact internal IP addresses, usernames, raw events, and technical vulnerability details.
- Expired/replayed MFA challenges and sessions must not authenticate a user.
- A Wazuh connector outage must show stale data, not a false healthy state.
- Re-reading an overlapping Wazuh query window must not create duplicate incidents.
- Repeated failed logins must lock or slow the account, and MFA recovery must need a Security Administrator and leave an audit record.

---

### Task 1: Scaffold the Portal and deployment boundary

**Files:**
- Create: `portal/package.json`
- Create: `portal/src/app/layout.tsx`
- Create: `portal/src/app/page.tsx`
- Create: `portal/src/lib/config.ts`
- Create: `portal/.env.example`
- Test: `portal/src/lib/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): PortalConfig`.

- [ ] **Step 1: Write failing configuration tests**

Assert missing database, session, TOTP, Wazuh Indexer endpoint and service-account, or trusted-network configuration fails at startup without echoing secrets.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- config.test.ts`  
Expected: FAIL because Portal configuration is absent.

- [ ] **Step 3: Create Next.js TypeScript project and implement `loadConfig`**

Commit only variable names and non-secret examples in `.env.example`.

- [ ] **Step 4: Run unit tests and production build**

Run: `npm test -- config.test.ts` and `npm run build`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal
git commit -m "feat: scaffold security operations portal"
```

### Task 2: Create Portal MariaDB schema and audit primitives

**Files:**
- Create: `portal/prisma/schema.prisma`
- Create: `portal/src/lib/audit.ts`
- Create: `portal/src/lib/audit.test.ts`
- Create: `portal/prisma/seed.ts`

**Interfaces:**
- Produces: `appendAudit(input: AuditInput): Promise<AuditRecord>` and models for User, Role, Asset, AlertReference, Incident, IncidentTimelineEntry, ClosureEvidence, and AuditRecord.

- [ ] **Step 1: Write failing audit tests**

Assert every mutation records actor, action, target type/id, UTC time, safe metadata, and correlation id. Reject audit data containing passwords, TOTP secrets, raw log payloads, or patient fields.

- [ ] **Step 2: Run audit tests before schema implementation**

Run: `npm test -- audit.test.ts`  
Expected: FAIL because schema and audit service are absent.

- [ ] **Step 3: Implement separate MariaDB schema and append-only audit service**

Persist Wazuh alert id, source, severity, timestamps, and investigation link only—not raw-event payloads.

- [ ] **Step 4: Apply migration to a disposable MariaDB test database and run tests**

Expected: PASS; no HOSxP connection appears in configuration or migration output.

- [ ] **Step 5: Commit**

```bash
git add portal/prisma portal/src/lib/audit*
git commit -m "feat: add portal security data model"
```

### Task 3: Implement local identity, MFA, roles, and network restriction

**Files:**
- Create: `portal/src/lib/auth/password.ts`
- Create: `portal/src/lib/auth/totp.ts`
- Create: `portal/src/lib/auth/session.ts`
- Create: `portal/src/lib/auth/authorize.ts`
- Create: `portal/src/middleware.ts`
- Test: `portal/src/lib/auth/auth.test.ts`

**Interfaces:**
- Produces: `authenticate(credentials, totpCode): Promise<SessionUser>`, `requireRole(session, roles): SessionUser`, and `isTrustedRequest(request): boolean`.

- [ ] **Step 1: Write failing authorization tests**

Cover valid and invalid password/TOTP, expired/replayed TOTP, account lockout after repeated failures, administrator-approved MFA reset, Executive Viewer mutation denial, Operator configuration/approval denial, untrusted-network denial, CSRF rejection on mutations, and expired session.

- [ ] **Step 2: Run tests to verify failures**

Run: `npm test -- auth.test.ts`  
Expected: FAIL because auth modules are absent.

- [ ] **Step 3: Implement Argon2 passwords, encrypted TOTP secrets, secure sessions, lockout, MFA reset, CSRF protection, security headers (CSP), RBAC, and trusted-network middleware**

Keep an identity-provider interface separate so AD/LDAP can replace local identity without changing authorization code.

- [ ] **Step 4: Run unit and browser tests for all roles**

Expected: PASS; no protected route or mutation is available to Executive Viewer or from an untrusted source.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/auth portal/src/middleware.ts
git commit -m "feat: secure portal identity and roles"
```

### Task 4: Implement the asset register

**Files:**
- Create: `portal/src/lib/assets/service.ts`
- Create: `portal/src/app/assets/page.tsx`
- Test: `portal/src/lib/assets/service.test.ts`

**Interfaces:**
- Produces: `createAsset`, `updateAsset`, `listAssets(filter)`, and `markCriticalAsset(assetId, reason)`.

- [ ] **Step 1: Write failing asset tests**

Cover create/update by Security Administrator only, Critical Asset flag with reason, owner, expected log sources, and audit record per mutation. Reject patient data fields.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- assets/service.test.ts`  
Expected: FAIL because asset modules are absent.

- [ ] **Step 3: Implement the asset service and Thai-first UI**

Seed the first-scope Critical Assets from the spec: HOSxP-related servers, database services, backup services, domain controllers, and the Sophos Firewall.

- [ ] **Step 4: Run unit and role-access browser tests**

Expected: PASS; Executive Viewer and Security Operator cannot change assets.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/assets portal/src/app/assets
git commit -m "feat: add critical asset register"
```

### Task 5: Implement Wazuh intake and source health

**Files:**
- Create: `portal/src/lib/wazuh/client.ts`
- Create: `portal/src/lib/wazuh/normalize-alert.ts`
- Create: `portal/src/lib/wazuh/poller.ts`
- Create: `portal/src/lib/source-health.ts`
- Test: `portal/src/lib/wazuh/normalize-alert.test.ts`
- Test: `portal/src/lib/wazuh/poller.test.ts`
- Test: `portal/src/lib/source-health.test.ts`

**Interfaces:**
- Produces: `normalizeWazuhAlert(input): NormalizedAlert`, `pollWazuhAlerts(checkpoint, now): Promise<PollResult>`, `upsertAlertReference(alert): Promise<AlertReference>`, and `evaluateSourceHealth(source, now): SourceHealth`.

- [ ] **Step 1: Write failing intake tests**

Cover every Sophos Priority Signal, malformed alert, overlapping query window with the same alert id, Indexer timeout or auth failure, stale checkpoint, and a missing source.

- [ ] **Step 2: Run tests to verify failures**

Run: `npm test -- normalize-alert.test.ts poller.test.ts source-health.test.ts`  
Expected: FAIL because connector modules are absent.

- [ ] **Step 3: Implement the read-only Indexer client, scheduled poller, normalization, deduplication, and source-health evaluation**

Query only alert indices with the Wazuh Service Account, advance the checkpoint only after a successful write, and poll at one minute or less so P1 targets hold. Persist connector freshness. Failed or stale data must render degraded state, never healthy zero alerts. Develop against Wazuh alert fixtures until the real Indexer is accepted.

- [ ] **Step 4: Run fixture-based integration tests**

Expected: PASS; a re-read window updates one alert reference and raw payload is not persisted.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/wazuh portal/src/lib/source-health.ts
git commit -m "feat: pull Wazuh alert summaries"
```

### Task 6: Implement incident lifecycle and closure review

**Files:**
- Create: `portal/src/lib/incidents/service.ts`
- Create: `portal/src/lib/incidents/sla.ts`
- Create: `portal/src/app/incidents/page.tsx`
- Create: `portal/src/app/incidents/[incidentId]/page.tsx`
- Test: `portal/src/lib/incidents/service.test.ts`
- Test: `portal/src/lib/incidents/sla.test.ts`

**Interfaces:**
- Produces: `createIncident`, `assignIncident`, `acknowledgeIncident`, `transitionIncident`, `submitClosureEvidence`, and `reviewClosure`.

- [ ] **Step 1: Write failing lifecycle tests**

Assert allowed transitions, P1/P2/P3/P4 targets, P1/P2 reviewer separation, P3/P4 closure data, invalid transition rejection, and one audit record per mutation.

- [ ] **Step 2: Run tests to verify failures**

Run: `npm test -- service.test.ts sla.test.ts`  
Expected: FAIL because incident services are absent.

- [ ] **Step 3: Implement typed incident service and Thai-first operator UI**

Use UTC persistence and Asia/Bangkok rendering. Executive paths use redacted view models.

- [ ] **Step 4: Run lifecycle and role-flow browser tests**

Expected: PASS; an operator cannot self-review a P1/P2 closure and executive users cannot access technical evidence.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/incidents portal/src/app/incidents
git commit -m "feat: add auditable incident workflow"
```

### Task 7: Add P1/P2 notifications

**Files:**
- Create: `portal/src/lib/notifications/payload.ts`
- Create: `portal/src/lib/notifications/delivery.ts`
- Test: `portal/src/lib/notifications/payload.test.ts`
- Test: `portal/src/lib/notifications/delivery.test.ts`

**Interfaces:**
- Produces: `buildNotificationSummary(incident): NotificationSummary` and `deliverNotification(summary): Promise<DeliveryResult>`.

- [ ] **Step 1: Write failing payload and delivery-failure tests**

Assert LINE/email include only severity, incident number, detection time, system name, and Portal link. Assert delivery failure is audited and queued for escalation, and that P1/P2 send 24x7 while P3/P4 follow working hours.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- payload.test.ts delivery.test.ts`  
Expected: FAIL because notification modules are absent.

- [ ] **Step 3: Implement email and LINE OA adapters**

Use separate adapters; persist delivery status without secrets.

- [ ] **Step 4: Run unit tests and a simulated LINE/SMTP outage**

Expected: PASS; payloads contain no restricted fields and failures are visible in the Portal.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/notifications
git commit -m "feat: add redacted incident notifications"
```
