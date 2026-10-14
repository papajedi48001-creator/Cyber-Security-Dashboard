import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl, testPrisma } from "./test-db";
import { createAuditLog } from "../audit";
import { hashPassword } from "../auth/password";
import { createAuthService, PROVIDER_ID_ISSUER } from "../auth/service";
import { encryptSecret, generateTotpSecret, totpAt } from "../auth/totp";
import { PrismaAuditStore } from "./audit-store";
import { PrismaExternalIdentityStore, PrismaSessionStore, PrismaUserStore } from "./auth-stores";

const KEY = Buffer.alloc(32, 3);

describe.skipIf(!testDatabaseUrl)("auth stores (MariaDB)", () => {
  const prisma = testPrisma();
  afterAll(() => prisma?.$disconnect());

  it("logs in, validates and revokes a session end to end", async () => {
    const users = new PrismaUserStore(prisma);
    const service = createAuthService({
      users,
      sessions: new PrismaSessionStore(prisma),
      externalIdentities: new PrismaExternalIdentityStore(prisma),
      audit: createAuditLog(new PrismaAuditStore(prisma)),
      totpKey: KEY,
    });
    const secret = generateTotpSecret();
    const username = `db.user.${Date.now()}`;
    await users.create({
      username,
      displayName: "DB User",
      role: "SECURITY_OPERATOR",
      passwordHash: await hashPassword("a long enough password"),
      totpSecretEnc: encryptSecret(secret, KEY),
    });
    const result = await service.authenticate(
      { username, password: "a long enough password", totpCode: totpAt(secret, new Date()) },
      { ip: "192.0.2.1", correlationId: "db-test" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = await service.validateSession(result.token);
    expect(session?.user.username).toBe(username);
    expect((await users.findByUsername(username))?.lastTotpStep).toBeGreaterThan(0);
    await service.logout(result.token, "db-test");
    expect(await service.validateSession(result.token)).toBeNull();
  });

  it("keeps one Provider ID Link per Provider ID and per user, and unlinks", async () => {
    const users = new PrismaUserStore(prisma);
    const links = new PrismaExternalIdentityStore(prisma);
    const stamp = Date.now();
    const make = (name: string) =>
      users.create({ username: `${name}.${stamp}`, displayName: name, role: "SECURITY_OPERATOR", passwordHash: "x", totpSecretEnc: null });
    const a = await make("link.a");
    const b = await make("link.b");
    const subject = `PID${stamp}`;
    await links.link({ userId: a.id, issuer: PROVIDER_ID_ISSUER, subject, linkedAt: new Date(), linkedById: a.id });
    expect(await links.findBySubject(PROVIDER_ID_ISSUER, subject)).toMatchObject({ userId: a.id, subject });
    expect(await links.findForUser(a.id, PROVIDER_ID_ISSUER)).toMatchObject({ subject });
    expect((await links.list(PROVIDER_ID_ISSUER)).some((l) => l.userId === a.id)).toBe(true);
    await expect(
      links.link({ userId: b.id, issuer: PROVIDER_ID_ISSUER, subject, linkedAt: new Date(), linkedById: a.id }),
    ).rejects.toThrow();
    await expect(
      links.link({ userId: a.id, issuer: PROVIDER_ID_ISSUER, subject: `${subject}x`, linkedAt: new Date(), linkedById: a.id }),
    ).rejects.toThrow();
    expect(await links.unlink(a.id, PROVIDER_ID_ISSUER)).toBe(true);
    expect(await links.unlink(a.id, PROVIDER_ID_ISSUER)).toBe(false);
    expect(await links.findBySubject(PROVIDER_ID_ISSUER, subject)).toBeNull();
  });

  it("persists a pending MFA challenge that never validates as a session", async () => {
    const users = new PrismaUserStore(prisma);
    const links = new PrismaExternalIdentityStore(prisma);
    const service = createAuthService({
      users,
      sessions: new PrismaSessionStore(prisma),
      externalIdentities: links,
      audit: createAuditLog(new PrismaAuditStore(prisma)),
      totpKey: KEY,
    });
    const secret = generateTotpSecret();
    const stamp = Date.now();
    const user = await users.create({
      username: `pid.user.${stamp}`,
      displayName: "PID User",
      role: "SECURITY_OPERATOR",
      passwordHash: await hashPassword("a long enough password"),
      totpSecretEnc: encryptSecret(secret, KEY),
    });
    await links.link({ userId: user.id, issuer: PROVIDER_ID_ISSUER, subject: `PIDDB${stamp}`, linkedAt: new Date(), linkedById: user.id });
    const ctx = { ip: "192.0.2.1", correlationId: "db-test" };
    const begun = await service.beginExternalLogin({ issuer: PROVIDER_ID_ISSUER, subject: `PIDDB${stamp}` }, ctx);
    if (!begun.ok) throw new Error("expected a challenge");
    expect(await service.validateSession(begun.challenge)).toBeNull();
    const done = await service.completeMfaChallenge(begun.challenge, totpAt(secret, new Date()), ctx);
    expect(done.ok).toBe(true);
    if (done.ok) expect((await service.validateSession(done.token))?.user.id).toBe(user.id);
  });
});
