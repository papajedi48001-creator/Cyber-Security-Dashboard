import { describe, expect, it } from "vitest";
import { InMemoryAuditStore, createAuditLog } from "../audit";
import { can, ForbiddenError, requireRole } from "./authorize";
import { hashPassword, verifyPassword, PasswordPolicyError } from "./password";
import { isTrustedRequest } from "./network";
import { createAuthService, InMemoryExternalIdentityStore, InMemoryUserStore, InMemorySessionStore, type AuthService } from "./service";
import { decryptSecret, encryptSecret, generateTotpSecret, totpAt } from "./totp";

const KEY = Buffer.alloc(32, 9);
const T0 = new Date("2026-10-14T03:00:00Z");
const PASSWORD = "correct horse battery staple";

async function setup(role: "SECURITY_ADMINISTRATOR" | "SECURITY_OPERATOR" | "EXECUTIVE_VIEWER" = "SECURITY_OPERATOR") {
  let now = T0;
  const clock = () => now;
  const users = new InMemoryUserStore();
  const sessions = new InMemorySessionStore();
  const auditStore = new InMemoryAuditStore();
  const service = createAuthService({
    users,
    sessions,
    externalIdentities: new InMemoryExternalIdentityStore(),
    audit: createAuditLog(auditStore, clock),
    totpKey: KEY,
    clock,
  });
  const secret = generateTotpSecret();
  const user = await users.create({
    username: "operator.a",
    displayName: "Operator A",
    role,
    passwordHash: await hashPassword(PASSWORD),
    totpSecretEnc: encryptSecret(secret, KEY),
  });
  return {
    service,
    users,
    sessions,
    auditStore,
    user,
    secret,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
  };
}

async function login(ctx: Awaited<ReturnType<typeof setup>>, overrides: { password?: string; code?: string } = {}) {
  return ctx.service.authenticate(
    { username: "operator.a", password: overrides.password ?? PASSWORD, totpCode: overrides.code ?? totpAt(ctx.secret, ctx.now()) },
    { ip: "192.0.2.5", correlationId: "c1" },
  );
}

describe("password", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, "wrong password here")).toBe(false);
  });

  it("enforces a minimum length", async () => {
    await expect(hashPassword("short")).rejects.toBeInstanceOf(PasswordPolicyError);
  });
});

describe("TOTP", () => {
  it("encrypts secrets at rest with AES-GCM", () => {
    const secret = generateTotpSecret();
    const enc = encryptSecret(secret, KEY);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc, KEY)).toBe(secret);
    expect(() => decryptSecret(enc, Buffer.alloc(32, 1))).toThrow();
  });

  it("matches the RFC 6238 SHA-1 test vector", () => {
    // RFC 6238 Appendix B: secret "12345678901234567890", T=59s -> 94287082 (8 digits) -> 287082 (6 digits)
    const base32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpAt(base32, new Date(59_000))).toBe("287082");
  });
});

describe("authenticate", () => {
  it("creates a session for valid password and TOTP", async () => {
    const ctx = await setup();
    const result = await login(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const session = await ctx.service.validateSession(result.token);
    expect(session?.user.username).toBe("operator.a");
    expect(ctx.auditStore.records.map((r) => r.action)).toContain("auth.login_succeeded");
  });

  it("stores only a hash of the session token", async () => {
    const ctx = await setup();
    const result = await login(ctx);
    if (!result.ok) throw new Error("login failed");
    expect([...ctx.sessions.byId.keys()]).not.toContain(result.token);
  });

  it("rejects a wrong password or wrong TOTP with the same generic error", async () => {
    const ctx = await setup();
    const badPassword = await login(ctx, { password: "wrong password value" });
    const badCode = await login(ctx, { code: "000000" });
    expect(badPassword).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(badCode).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("rejects an unknown user with the same generic error", async () => {
    const ctx = await setup();
    const result = await ctx.service.authenticate(
      { username: "nobody", password: PASSWORD, totpCode: "123456" },
      { ip: "192.0.2.5", correlationId: "c1" },
    );
    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("rejects a replayed TOTP code", async () => {
    const ctx = await setup();
    const code = totpAt(ctx.secret, ctx.now());
    expect((await login(ctx, { code })).ok).toBe(true);
    expect(await login(ctx, { code })).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("rejects an expired TOTP code", async () => {
    const ctx = await setup();
    const code = totpAt(ctx.secret, ctx.now());
    ctx.advance(5 * 60_000);
    expect((await login(ctx, { code })).ok).toBe(false);
  });

  it("locks the account after repeated failures, even with correct credentials", async () => {
    const ctx = await setup();
    for (let i = 0; i < 5; i++) await login(ctx, { password: "wrong password value" });
    expect(await login(ctx)).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(ctx.auditStore.records.map((r) => r.action)).toContain("auth.account_locked");
    ctx.advance(16 * 60_000);
    expect((await login(ctx)).ok).toBe(true);
  });

  it("rejects disabled accounts", async () => {
    const ctx = await setup();
    await ctx.users.update(ctx.user.id, { active: false });
    expect((await login(ctx)).ok).toBe(false);
  });

  it("never records the password or code in the audit trail", async () => {
    const ctx = await setup();
    await login(ctx, { password: "wrong password value" });
    expect(JSON.stringify(ctx.auditStore.records)).not.toContain("wrong password value");
  });
});

describe("sessions", () => {
  it("expires after idle timeout and absolute lifetime", async () => {
    const ctx = await setup();
    const result = await login(ctx);
    if (!result.ok) throw new Error("login failed");
    ctx.advance(31 * 60_000);
    expect(await ctx.service.validateSession(result.token)).toBeNull();

    const again = await login(ctx);
    if (!again.ok) throw new Error("login failed");
    for (let i = 0; i < 26; i++) {
      ctx.advance(29 * 60_000);
      await ctx.service.validateSession(again.token);
    }
    expect(await ctx.service.validateSession(again.token)).toBeNull();
  });

  it("logout revokes the session", async () => {
    const ctx = await setup();
    const result = await login(ctx);
    if (!result.ok) throw new Error("login failed");
    await ctx.service.logout(result.token, "c2");
    expect(await ctx.service.validateSession(result.token)).toBeNull();
  });

  it("verifies the CSRF token bound to the session", async () => {
    const ctx = await setup();
    const result = await login(ctx);
    if (!result.ok) throw new Error("login failed");
    const session = await ctx.service.validateSession(result.token);
    expect(ctx.service.verifyCsrf(session!, session!.csrfToken)).toBe(true);
    expect(ctx.service.verifyCsrf(session!, "forged")).toBe(false);
    expect(ctx.service.verifyCsrf(session!, undefined)).toBe(false);
  });
});

describe("MFA reset", () => {
  it("lets a Security Administrator reset another user's MFA and audits it", async () => {
    const ctx = await setup();
    const admin = await ctx.users.create({
      username: "admin.b", displayName: "Admin B", role: "SECURITY_ADMINISTRATOR",
      passwordHash: await hashPassword(PASSWORD), totpSecretEnc: encryptSecret(generateTotpSecret(), KEY),
    });
    const enrollment = await ctx.service.resetMfa({ actor: admin, userId: ctx.user.id, correlationId: "c3" });
    expect(enrollment.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(ctx.auditStore.records.map((r) => r.action)).toContain("user.mfa_reset");
    expect((await login(ctx)).ok).toBe(false); // old secret no longer valid
  });

  it("refuses an operator, or an administrator resetting their own MFA", async () => {
    const ctx = await setup("SECURITY_ADMINISTRATOR");
    await expect(ctx.service.resetMfa({ actor: ctx.user, userId: ctx.user.id, correlationId: "c" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const op = await setup("SECURITY_OPERATOR");
    await expect(op.service.resetMfa({ actor: op.user, userId: "other", correlationId: "c" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("authorization", () => {
  const user = (role: "SECURITY_ADMINISTRATOR" | "SECURITY_OPERATOR" | "EXECUTIVE_VIEWER") => ({ id: "u", role });

  it("denies every mutation to Executive Viewer", () => {
    for (const permission of ["incident.write", "incident.review", "asset.write", "user.manage", "config.manage"] as const) {
      expect(can(user("EXECUTIVE_VIEWER"), permission)).toBe(false);
    }
    expect(can(user("EXECUTIVE_VIEWER"), "executive.read")).toBe(true);
    expect(can(user("EXECUTIVE_VIEWER"), "incident.read")).toBe(false);
  });

  it("denies configuration and user management to Security Operator", () => {
    expect(can(user("SECURITY_OPERATOR"), "incident.write")).toBe(true);
    expect(can(user("SECURITY_OPERATOR"), "config.manage")).toBe(false);
    expect(can(user("SECURITY_OPERATOR"), "user.manage")).toBe(false);
    expect(can(user("SECURITY_OPERATOR"), "asset.write")).toBe(false);
  });

  it("requireRole throws ForbiddenError without revealing the resource", () => {
    expect(() => requireRole(user("SECURITY_OPERATOR"), ["SECURITY_ADMINISTRATOR"])).toThrow(ForbiddenError);
    expect(requireRole(user("SECURITY_ADMINISTRATOR"), ["SECURITY_ADMINISTRATOR"]).role).toBe("SECURITY_ADMINISTRATOR");
  });
});

describe("trusted network", () => {
  const networks = ["192.0.2.0/24"];
  const request = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

  it("allows a client IP from the trusted networks set by the reverse proxy", () => {
    expect(isTrustedRequest(request({ "x-real-ip": "192.0.2.40" }), networks)).toBe(true);
  });

  it("denies other or missing client IPs", () => {
    expect(isTrustedRequest(request({ "x-real-ip": "203.0.113.5" }), networks)).toBe(false);
    expect(isTrustedRequest(request({}), networks)).toBe(false);
  });

  it("ignores a client-supplied X-Forwarded-For", () => {
    expect(isTrustedRequest(request({ "x-forwarded-for": "192.0.2.40", "x-real-ip": "203.0.113.5" }), networks)).toBe(
      false,
    );
  });
});
