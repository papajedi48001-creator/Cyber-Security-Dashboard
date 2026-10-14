// Bootstrap the first Security Administrator. Refuses when an active
// administrator already exists; later accounts are created in the Portal.
// Usage: npx tsx scripts/create-admin.ts   (prompts; never pass passwords as arguments)
import { createInterface } from "node:readline/promises";
import { PrismaClient } from "@prisma/client";
import { createAuditLog } from "../src/lib/audit";
import { hashPassword } from "../src/lib/auth/password";
import { encryptSecret, generateTotpSecret, otpauthUri } from "../src/lib/auth/totp";
import { loadConfig } from "../src/lib/config";
import { PrismaAuditStore } from "../src/lib/db/audit-store";

async function main() {
  const config = loadConfig();
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.count({ where: { role: "SECURITY_ADMINISTRATOR", active: true } });
    if (existing > 0) throw new Error("An active Security Administrator already exists; create accounts in the Portal.");
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const username = (await rl.question("Username: ")).trim().toLowerCase();
    const displayName = (await rl.question("Display name: ")).trim();
    const password = await rl.question("Initial password (min 12 chars): ");
    rl.close();
    const secret = generateTotpSecret();
    const user = await prisma.user.create({
      data: {
        username,
        displayName,
        role: "SECURITY_ADMINISTRATOR",
        passwordHash: await hashPassword(password),
        totpSecretEnc: encryptSecret(secret, config.totpEncryptionKey),
      },
    });
    await createAuditLog(new PrismaAuditStore(prisma)).append({
      actor: { id: null, label: "system:bootstrap" },
      action: "user.created",
      target: { type: "User", id: user.id },
      metadata: { username, role: "SECURITY_ADMINISTRATOR", via: "create-admin script" },
      correlationId: `bootstrap-${Date.now()}`,
    });
    console.log("\nEnrol this secret in an authenticator app now. It is shown once.");
    console.log(otpauthUri(secret, username));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
