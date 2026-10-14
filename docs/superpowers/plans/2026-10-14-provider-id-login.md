# Provider ID Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let linked Portal Users sign in with the Ministry of Public Health Provider ID, followed by Portal MFA, while Local Account login stays as break-glass.

**Architecture:** A `ProviderIdClient` interface hides Health ID and Provider ID behind two calls: build the authorization URL and exchange a code for a minimal profile (`providerId`, `hcodes`). `createProviderIdLogin` runs the OAuth state and PKCE checks and the hospital check, then hands the Provider ID to the auth service, which looks up the Provider ID Link and opens a single-use, five-minute MFA challenge stored as a `Session` row with `mfaPassed = false`. Only a correct TOTP code turns the challenge into a normal session with a fresh token.

**Decision:** [ADR 0009](../../adr/0009-provider-id-login-for-the-portal.md)

## Global Constraints

- No automatic accounts; only linked, active, unlocked Portal Users with enrolled TOTP can complete Provider ID Login.
- Store only issuer and Provider ID. Never store or log national ID numbers, provider tokens or raw profiles.
- A pending MFA challenge never authorizes a page or action.
- Provider ID Login is hidden unless a Provider ID client is configured. No fake client is wired into the running Portal.
- Provider outages render as "unavailable", never as a generic credential error.

## Review Focus

- Missing, mismatched or reused `state` must fail before any code exchange.
- A challenge token must not pass `validateSession`, must expire after five minutes, and must not be usable twice.
- Wrong TOTP codes after Provider ID count toward account lockout.
- Linking must refuse a Provider ID already linked to another user and must be audited.

---

### Task 1: ADR, glossary and plan

- [x] Write ADR 0009, add Provider ID Login and Provider ID Link to `CONTEXT.md`, and reference ADR 0009 from the design.

### Task 2: Provider ID Link storage

**Files:** `portal/prisma/schema.prisma`, new migration, `portal/src/lib/db/auth-stores.ts`, `portal/src/lib/db/auth-stores.db.test.ts`

- [x] Write failing DB tests: link, find by issuer and subject, one link per user per issuer, one user per Provider ID, unlink.
- [x] Add `ExternalIdentity` (unique `issuer`+`subject`, unique `userId`+`issuer`) and `PrismaExternalIdentityStore`; persist `Session.mfaPassed`.

### Task 3: Auth service MFA challenge

**Files:** `portal/src/lib/auth/service.ts`, `portal/src/lib/auth/external-login.test.ts`

- [x] Write failing tests for `beginExternalLogin`, `completeMfaChallenge`, `linkExternalIdentity`, `unlinkExternalIdentity`, and that `validateSession` rejects a challenge token.
- [x] Implement them, sharing session creation and lockout with password login.

### Task 4: Provider ID login flow

**Files:** `portal/src/lib/auth/provider-id.ts`, `portal/src/lib/auth/provider-id.test.ts`

- [x] Write failing tests with a fake client: state mismatch, provider outage, wrong hospital, unlinked Provider ID, success.
- [x] Implement PKCE, state comparison and the hospital check.

### Task 5: Routes, pages and admin linking

**Files:** `portal/src/app/login/provider-id/start/route.ts`, `portal/src/app/login/provider-id/callback/route.ts`, `portal/src/app/login/mfa/*`, `portal/src/app/(app)/admin/users/*`

- [x] Add the start and callback routes (cookie `__Host-portal_pid_flow`, `SameSite=Lax`, ten minutes), the MFA page (cookie `__Host-portal_mfa_challenge`), the login button shown only when configured, and the admin link and unlink forms.

### Task 6: Real Provider ID adapter (blocked)

- [ ] Implement the HTTP adapter for Health ID and Provider ID from the official documentation received with the hospital's client registration, with configuration in `.env.example` (`PROVIDER_ID_*`) and tests against recorded synthetic responses.

### Task 7: UAT (blocked)

- [ ] With hospital approval for the outbound firewall path, test on staging with real staff accounts: linked login, unlinked refusal, wrong-hospital refusal, provider outage fallback to Local Account.
