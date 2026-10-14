import { describe, expect, it } from "vitest";
import { InMemoryAuditStore, createAuditLog } from "../audit";
import { ForbiddenError } from "./authorize";
import { hashPassword } from "./password";
import {
  createAuthService,
  InMemoryExternalIdentityStore,
  InMemorySessionStore,
  InMemoryUserStore,
  MAX_FAILED_LOGINS,
  MFA_CHALLENGE_MS,
  PROVIDER_ID_ISSUER,
} from "./service";
import { encryptSecret, generateTotpSecret, totpAt } from "./totp";

const KEY = Buffer.alloc(32, 7);
const T0 = new Date("2026-10-14T03:00:00Z");
const ISSUER = PROVIDER_ID_ISSUER;
const PROVIDER_ID = "PID0001";
const CTX = { ip: "192.0.2.9", correlationId: "c-ext" };

async function setup() {
  let now = T0;
  const clock = () => now;
  const users = new InMemoryUserStore();
  const sessions = new InMemorySessionStore();
  const externalIdentities = new InMemoryExternalIdentityStore();
  const auditStore = new InMemoryAuditStore();
  const service = createAuthService({
    users,
    sessions,
    externalIdentities,
    audit: createAuditLog(auditStore, clock),
    totpKey: KEY,
    clock,
  });
  const make = async (username: string, role: "SECURITY_ADMINISTRATOR" | "SECURITY_OPERATOR", secret: string) =>
    users.create({
      username,
      displayName: username,
      role,
      passwordHash: await hashPassword("a long enough password"),
      totpSecretEnc: encryptSecret(secret, KEY),
    });
  const secret = generateTotpSecret();
  const admin = await make("admin.a", "SECURITY_ADMINISTRATOR", generateTotpSecret());
  const operator = await make("operator.a", "SECURITY_OPERATOR", secret);
  const adminActor = { id: admin.id, username: admin.username, displayName: admin.displayName, role: admin.role };
  return {
    service,
    users,
    sessions,
    externalIdentities,
    auditStore,
    secret,
    admin: adminActor,
    operator,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
    link: () =>
      service.linkExternalIdentity({
        actor: adminActor,
        userId: operator.id,
        issuer: ISSUER,
        subject: PROVIDER_ID,
        correlationId: "c-link",
      }),
  };
}

describe("Provider ID Link management", () => {
  it("lets a Security Administrator link and unlink a Provider ID, with audit records", async () => {
    const ctx = await setup();
    await ctx.link();
    expect(await ctx.externalIdentities.findBySubject(ISSUER, PROVIDER_ID)).toMatchObject({ userId: ctx.operator.id });
    const listed = await ctx.service.listUsers(ctx.admin);
    expect(listed.find((u) => u.id === ctx.operator.id)?.providerId).toBe(PROVIDER_ID);

    await ctx.service.unlinkExternalIdentity({ actor: ctx.admin, userId: ctx.operator.id, issuer: ISSUER, correlationId: "c-unlink" });
    expect(await ctx.externalIdentities.findBySubject(ISSUER, PROVIDER_ID)).toBeNull();
    const actions = ctx.auditStore.records.map((e) => e.action);
    expect(actions).toContain("user.external_identity_linked");
    expect(actions).toContain("user.external_identity_unlinked");
  });

  it("refuses a Provider ID already linked to another user, and a second link for the same user", async () => {
    const ctx = await setup();
    await ctx.link();
    await expect(
      ctx.service.linkExternalIdentity({ actor: ctx.admin, userId: ctx.admin.id, issuer: ISSUER, subject: PROVIDER_ID, correlationId: "c" }),
    ).rejects.toThrow();
    await expect(
      ctx.service.linkExternalIdentity({ actor: ctx.admin, userId: ctx.operator.id, issuer: ISSUER, subject: "PID0002", correlationId: "c" }),
    ).rejects.toThrow();
  });

  it("rejects a malformed Provider ID", async () => {
    const ctx = await setup();
    await expect(
      ctx.service.linkExternalIdentity({ actor: ctx.admin, userId: ctx.operator.id, issuer: ISSUER, subject: "bad id;", correlationId: "c" }),
    ).rejects.toThrow();
  });

  it("refuses linking by anyone without user.manage", async () => {
    const ctx = await setup();
    const operatorActor = { id: ctx.operator.id, username: "operator.a", displayName: "operator.a", role: ctx.operator.role };
    await expect(
      ctx.service.linkExternalIdentity({ actor: operatorActor, userId: ctx.operator.id, issuer: ISSUER, subject: PROVIDER_ID, correlationId: "c" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Provider ID Login with Portal MFA", () => {
  it("refuses an unlinked Provider ID without opening a challenge", async () => {
    const ctx = await setup();
    const result = await ctx.service.beginExternalLogin({ issuer: ISSUER, subject: PROVIDER_ID }, CTX);
    expect(result).toEqual({ ok: false, reason: "not_linked" });
    expect(ctx.sessions.byId.size).toBe(0);
    expect(ctx.auditStore.records.at(-1)).toMatchObject({ action: "auth.login_failed", metadata: { reason: "not_linked", method: "provider_id" } });
  });

  it("opens a challenge that is not a session, then a correct TOTP code creates a fresh session", async () => {
    const ctx = await setup();
    await ctx.link();
    const begun = await ctx.service.beginExternalLogin({ issuer: ISSUER, subject: PROVIDER_ID }, CTX);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(await ctx.service.validateSession(begun.challenge)).toBeNull();

    const done = await ctx.service.completeMfaChallenge(begun.challenge, totpAt(ctx.secret, ctx.now()), CTX);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.token).not.toBe(begun.challenge);
    expect((await ctx.service.validateSession(done.token))?.user.username).toBe("operator.a");
    expect(ctx.auditStore.records.at(-1)).toMatchObject({ action: "auth.login_succeeded", metadata: { method: "provider_id" } });
  });

  it("uses a challenge only once", async () => {
    const ctx = await setup();
    await ctx.link();
    const begun = await ctx.service.beginExternalLogin({ issuer: ISSUER, subject: PROVIDER_ID }, CTX);
    if (!begun.ok) throw new Error("expected a challenge");
    expect((await ctx.service.completeMfaChallenge(begun.challenge, totpAt(ctx.secret, ctx.now()), CTX)).ok).toBe(true);
    ctx.advance(30_000);
    expect((await ctx.service.completeMfaChallenge(begun.challenge, totpAt(ctx.secret, ctx.now()), CTX)).ok).toBe(false);
  });

  it("expires a challenge after five minutes", async () => {
    const ctx = await setup();
    await ctx.link();
    const begun = await ctx.service.beginExternalLogin({ issuer: ISSUER, subject: PROVIDER_ID }, CTX);
    if (!begun.ok) throw new Error("expected a challenge");
    ctx.advance(MFA_CHALLENGE_MS + 1);
    expect((await ctx.service.completeMfaChallenge(begun.challenge, totpAt(ctx.secret, ctx.now()), CTX)).ok).toBe(false);
  });

  it("drops the challenge on a wrong code and counts it toward lockout", async () => {
    const ctx = await setup();
    await ctx.link();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      const begun = await ctx.service.beginExternalLogin({ issuer: ISSUER, subject: PROVIDER_ID }, CTX);
      if (!begun.ok) throw new Error("expected a challenge");
      expect((await ctx.service.completeMfaChallenge(begun.challenge, "000000", CTX)).ok).toBe(false);
      expect((await ctx.service.completeMfaChallenge(begun.challenge, totpAt(ctx.secret, ctx.now()), CTX)).ok).toBe(false);
    }
    expect(await ctx.service.beginExternalLogin({ issuer: ISSUER, subject: PROVIDER_ID }, CTX)).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
    expect(ctx.auditStore.records.map((e) => e.action)).toContain("auth.account_locked");
  });

  it("refuses disabled accounts and accounts without enrolled TOTP", async () => {
    const ctx = await setup();
    await ctx.link();
    await ctx.users.update(ctx.operator.id, { active: false });
    expect((await ctx.service.beginExternalLogin({ issuer: ISSUER, subject: PROVIDER_ID }, CTX)).ok).toBe(false);
    await ctx.users.update(ctx.operator.id, { active: true, totpSecretEnc: null });
    expect((await ctx.service.beginExternalLogin({ issuer: ISSUER, subject: PROVIDER_ID }, CTX)).ok).toBe(false);
  });
});
