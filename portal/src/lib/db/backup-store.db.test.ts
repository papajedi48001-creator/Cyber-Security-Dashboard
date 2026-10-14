import { afterAll, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { createBackupService } from "../backups/service";
import { PrismaBackupStore } from "./backup-store";
import { testDatabaseUrl, testPrisma } from "./test-db";

describe.skipIf(!testDatabaseUrl)("PrismaBackupStore (MariaDB)", () => {
  const prisma = testPrisma();
  afterAll(() => prisma?.$disconnect());

  it("stores large backups and keeps recovery separate from job success", async () => {
    const admin = { id: "admin", username: "admin", role: "SECURITY_ADMINISTRATOR" as const };
    const service = createBackupService({ store: new PrismaBackupStore(prisma), audit: createAuditLog(new InMemoryAuditStore()) });
    const name = `db-job-${Date.now().toString(36)}`;
    await service.createJob(admin, { name, assetName: "hosxp-db", expectedIntervalHours: 24, destination: "GDCC" }, "c");
    await service.recordBackupEvidence(
      admin,
      { jobName: name, result: "SUCCESS", completedAt: new Date(), sizeBytes: 3_000_000_000_000, encrypted: true, retentionUntil: null },
      "c",
    );
    const status = (await service.listBackupStatus(admin)).find((s) => s.job.name === name)!;
    expect(status).toMatchObject({ health: "ok", sizeBytes: 3_000_000_000_000, recovery: "unconfirmed" });
  });
});
