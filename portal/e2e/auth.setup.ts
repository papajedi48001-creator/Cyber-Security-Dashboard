import { PrismaClient } from "@prisma/client";
import { expect, test as setup } from "@playwright/test";
import { hashPassword } from "../src/lib/auth/password";
import { encryptSecret, totpAt } from "../src/lib/auth/totp";
import { E2E_ENV, E2E_PASSWORD, E2E_USERS, storageFile, type E2ERole } from "./env";

// Fixed TOTP secrets per user so the setup can compute codes (test-only).
const SECRETS: Record<E2ERole, string> = {
  admin: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXA",
  opA: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXB",
  opB: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXC",
  exec: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXD",
};

setup("create e2e users and sign each one in", async ({ browser }) => {
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_ENV.DATABASE_URL } } });
  const key = Buffer.from(E2E_ENV.TOTP_ENCRYPTION_KEY!, "base64");
  const passwordHash = await hashPassword(E2E_PASSWORD);
  try {
    for (const [role, user] of Object.entries(E2E_USERS) as [E2ERole, (typeof E2E_USERS)[E2ERole]][]) {
      const data = {
        displayName: user.displayName,
        role: user.role,
        passwordHash,
        totpSecretEnc: encryptSecret(SECRETS[role], key),
        totpEnrolledAt: new Date(),
        lastTotpStep: null,
        failedLoginCount: 0,
        lockedUntil: null,
        active: true,
      };
      const saved = await prisma.user.upsert({ where: { username: user.username }, update: data, create: { ...data, username: user.username } });
      await prisma.session.deleteMany({ where: { userId: saved.id } });
    }
  } finally {
    await prisma.$disconnect();
  }

  for (const role of Object.keys(E2E_USERS) as E2ERole[]) {
    const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "192.0.2.10" } });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("ชื่อผู้ใช้").fill(E2E_USERS[role].username);
    await page.getByLabel("รหัสผ่าน").fill(E2E_PASSWORD);
    await page.getByLabel("รหัส MFA 6 หลัก").fill(totpAt(SECRETS[role], new Date()));
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await expect(page).toHaveURL(role === "exec" ? /\/executive$/ : /\/overview$/);
    await context.storageState({ path: storageFile(role) });
    await context.close();
  }
});
