// Seeds the first-scope Critical Assets and the Sophos log source from the
// design spec. Idempotent. Contains no patient data and no credentials.
import { PrismaClient } from "@prisma/client";

const CRITICAL_ASSETS = [
  { name: "hosxp-app", role: "HOSxP application server", criticalReason: "ระบบบริการหลักของโรงพยาบาล" },
  { name: "hosxp-db", role: "HOSxP database service", criticalReason: "ฐานข้อมูลระบบบริการหลัก" },
  { name: "backup-server", role: "Backup service", criticalReason: "ใช้กู้คืนระบบเมื่อเกิดเหตุ" },
  { name: "dc01", role: "Domain controller", criticalReason: "ควบคุมการยืนยันตัวตนภายใน" },
  { name: "sophos-firewall", role: "Perimeter firewall", criticalReason: "ด่านหน้าเครือข่ายและแหล่ง log หลัก" },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const asset of CRITICAL_ASSETS) {
      await prisma.asset.upsert({
        where: { name: asset.name },
        update: {},
        create: { ...asset, owner: "IT โรงพยาบาล", critical: true },
      });
    }
    const firewall = await prisma.asset.findUniqueOrThrow({ where: { name: "sophos-firewall" } });
    await prisma.logSource.upsert({
      where: { name: "sophos-firewall" },
      update: {},
      create: { name: "sophos-firewall", type: "sophos_sfos", expectedIntervalMinutes: 5, assetId: firewall.id },
    });
    await prisma.logSource.upsert({
      where: { name: "log-relay" },
      update: {},
      create: { name: "log-relay", type: "relay_health", expectedIntervalMinutes: 5 },
    });
    console.log("Seeded critical assets and log sources.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
