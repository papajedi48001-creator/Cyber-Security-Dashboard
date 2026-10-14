# Security Operations Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add approved operational modules and executive reporting to the Portal without expanding its raw-log or patient-data boundary. Notifications are built in the Portal core plan.

**Architecture:** Each external source gets a narrow read-only adapter that emits a normalized status or summary. The Portal independently records freshness, errors, and audit records. Integrations do not share credentials or database access.

**Tech Stack:** Portal core plan; MariaDB; Wazuh summary connector; external port scanner (e.g. nmap) on a host outside the hospital network; Sophos configuration export; Cloudflare GraphQL/API read-only token; Duo Admin Panel manual-check workflow; GDCC-compatible backup evidence adapter; Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-waritchaphum-cyber-security-dashboard-design.md`

## Global Constraints

- Cloudflare Free WAF is always marked sampled, not complete raw-request evidence.
- Duo remains a manual check until a supported read-only API entitlement is verified.
- Backup monitoring is read-only; no restore or immediate deletion control exists in this phase.
- LINE and email send only Notification Summary fields.
- All connector credentials are read-only, secret-managed, rotatable, and excluded from logs.
- Portal exports and executive views are redacted.

## Review Focus

- A Cloudflare API failure must show stale/unavailable instead of zero attacks.
- A LINE payload must never contain a username, internal IP, raw log, detailed vulnerability, or patient data.
- Backup completion and verified restoration must remain distinct UI/data states.
- An allowed port exposure or egress exception must expire and return to review rather than stay permanent silently.
- Manual Duo checks must show their actual check time and operator, not impersonate live monitoring.

---

### Task 1: Add Backup Evidence and lifecycle boundaries

**Files:**
- Create: `portal/src/lib/backups/service.ts`
- Create: `portal/src/lib/backups/types.ts`
- Create: `portal/src/app/backups/page.tsx`
- Test: `portal/src/lib/backups/service.test.ts`

**Interfaces:**
- Produces: `recordBackupEvidence(input): Promise<BackupEvidence>` and `backupVerificationStatus(evidence): 'unconfirmed' | 'verified'`.

- [ ] **Step 1: Write failing Backup Evidence tests**

Cover success/failure, age, consecutive failures, encryption, retention, and the unconfirmed restore state.

- [ ] **Step 2: Run test before implementation**

Run: `npm test -- service.test.ts`  
Expected: FAIL because backup modules are absent.

- [ ] **Step 3: Implement read-only Backup Evidence persistence and Thai-first UI**

Do not create restore, immediate-delete, or live-backup command endpoints. Model future lifecycle requests behind disabled feature flags only.

- [ ] **Step 4: Run tests and role-access browser test**

Expected: PASS; Backup Job Success never renders as verified recovery without a separate verification record.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/backups portal/src/app/backups
git commit -m "feat: add backup evidence monitoring"
```

### Task 2: Add External Port Exposure and Restricted Egress monitoring

**Files:**
- Create: `portal/src/lib/port-monitor/service.ts`
- Create: `portal/src/lib/port-monitor/policy.ts`
- Create: `portal/src/lib/port-monitor/scan-import.ts`
- Create: `infrastructure/external-scan/README.md`
- Create: `portal/src/app/port-monitor/page.tsx`
- Test: `portal/src/lib/port-monitor/service.test.ts`

**Interfaces:**
- Consumes: External Exposure Scan results and Sophos NAT/WAN rule export for exposure (ADR 0007); normalized Wazuh/Sophos alerts for egress.
- Produces: `importExposureScan(result): Promise<ExposureSnapshot>` and `classifyPortFinding(input, policy): PortFinding` with `EXTERNAL_EXPOSURE` or `RESTRICTED_EGRESS`.

- [ ] **Step 1: Write failing classification and exception-expiry tests**

Cover approved exposure, unapproved SSH/RDP/database exposure seen by scan, exposure in Sophos rules but closed in scan, missing or stale scan, prohibited outbound port, expired exception, and separate families.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- service.test.ts`  
Expected: FAIL because port monitor is absent.

- [ ] **Step 3: Implement policy-backed classification and operator UI**

Keep allowlist approvals auditable with expiry; create or link an Incident according to severity policy.

- [ ] **Step 4: Run unit and browser tests**

Expected: PASS; an exposure cannot be hidden by an expired exception.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/port-monitor portal/src/app/port-monitor
git commit -m "feat: add port risk monitoring"
```

### Task 3: Add Cloudflare sampled WAF and Duo Manual Check

**Files:**
- Create: `portal/src/lib/cloudflare/client.ts`
- Create: `portal/src/lib/cloudflare/service.ts`
- Create: `portal/src/lib/duo/manual-check.ts`
- Create: `portal/src/app/web-application-firewall/page.tsx`
- Create: `portal/src/app/duo/page.tsx`
- Test: `portal/src/lib/cloudflare/service.test.ts`
- Test: `portal/src/lib/duo/manual-check.test.ts`

**Interfaces:**
- Produces: `getSampledWafSummary(range): Promise<SampledWafSummary>` and `recordDuoManualCheck(input): Promise<DuoManualCheck>`.

- [ ] **Step 1: Write failing tests for sampled labels, stale data, API failure, and manual-check operator/time**

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- service.test.ts manual-check.test.ts`  
Expected: FAIL because source modules are absent.

- [ ] **Step 3: Implement the Cloudflare read-only adapter and Duo manual-check workflow**

The WAF UI visibly states sampled data. The Duo UI states manual check and cannot imply real-time coverage.

- [ ] **Step 4: Run fixture and redaction tests**

Expected: PASS; failed or stale source has unavailable state, never zeroed metrics.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/cloudflare portal/src/lib/duo portal/src/app/web-application-firewall portal/src/app/duo
git commit -m "feat: add WAF and Duo monitoring"
```

### Task 4: Add operations summary and executive reporting

**Files:**
- Create: `portal/src/lib/reporting/executive-summary.ts`
- Create: `portal/src/app/overview/page.tsx`
- Create: `portal/src/app/executive/page.tsx`
- Test: `portal/src/lib/reporting/executive-summary.test.ts`

**Interfaces:**
- Produces: `getExecutiveSummary(range): ExecutiveSummary`.

- [ ] **Step 1: Write failing SLA and redaction tests**

Assert executive output has no internal IP, username, raw log, or detailed vulnerability, and that stale sources are shown as stale.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- executive-summary.test.ts`  
Expected: FAIL because reporting modules are absent.

- [ ] **Step 3: Implement Operations Overview and redacted Executive Summary**

Redact through server-side view models, not client-side hiding.

- [ ] **Step 4: Run unit and role-based browser tests**

Expected: PASS; executive views contain no restricted fields.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/reporting portal/src/app/overview portal/src/app/executive
git commit -m "feat: add security operations reporting"
```

### Task 5: Execute integration UAT and publish runbooks

**Files:**
- Create: `docs/operations/portal-integration-uat.md`
- Create: `docs/operations/notification-runbook.md`
- Create: `docs/operations/backup-evidence-runbook.md`
- Create: `docs/operations/duo-manual-check-runbook.md`
- Test: `portal/e2e/operations-flow.spec.ts`

**Interfaces:**
- Consumes: Portal core and all integration modules.
- Produces: UAT evidence and release-readiness recommendation; it does not authorize deployment.

- [ ] **Step 1: Write failing end-to-end scenarios**

Cover priority alert to P1 Incident, reviewer closure, notification failure, backup failure, expired port exception, sampled Cloudflare view, and Duo manual check.

- [ ] **Step 2: Run E2E scenarios before final wiring**

Run: `npm run test:e2e -- operations-flow.spec.ts`  
Expected: FAIL until every module is wired.

- [ ] **Step 3: Complete runbooks and execute UAT with synthetic records only**

Record actual results, defects, retest evidence, and outstanding risks. Do not use patient records.

- [ ] **Step 4: Run full test suite and UAT checklist**

Expected: unit, integration, and E2E tests pass; UAT evidence states whether release approval is recommended.

- [ ] **Step 5: Commit**

```bash
git add portal/e2e docs/operations
git commit -m "test: document security operations UAT"
```

