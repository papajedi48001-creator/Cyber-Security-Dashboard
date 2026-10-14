import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl, testPrisma } from "./test-db";
import { createAuditLog } from "../audit";
import { hashPassword } from "../auth/password";
import { createAuthService } from "../auth/service";
import { encryptSecret, generateTotpSecret, totpAt } from "../auth/totp";
import { PrismaAuditStore } from "./audit-store";
import { PrismaSessionStore, PrismaUserStore } from "./auth-stores";

const KEY = Buffer.alloc(32, 3);

describe.skipIf(!testDatabaseUrl)("auth stores (MariaDB)", () => {
  const prisma = testPrisma();
  afterAll(() => prisma?.$disconnect());

  it("logs in, validates and revokes a session end to end", async () => {
    const users = new PrismaUserStore(prisma);
    const service = createAuthService({
      users,
      sessions: new PrismaSessionStore(prisma),
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
});
