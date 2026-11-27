import { afterAll, describe, expect, it } from "vitest";
import { PrismaBackupFileRequestStore } from "./backup-file-store";
import { testDatabaseUrl, testPrisma } from "./test-db";

describe.skipIf(!testDatabaseUrl)("PrismaBackupFileRequestStore (MariaDB)", () => {
  const prisma = testPrisma();
  afterAll(() => prisma?.$disconnect());

  it("keeps 35 GB sizes and only moves a request from the expected status", async () => {
    const store = new PrismaBackupFileRequestStore(prisma);
    const created = await store.create({
      fileName: `MySQL_backup_db_${Date.now()}.ZIP`,
      sizeBytes: 35 * 1024 ** 3,
      reason: "synthetic test request",
      proposedById: "u-test",
      proposedByLabel: "test",
      proposedAt: new Date(),
    });
    expect(created).toMatchObject({ status: "PROPOSED", sizeBytes: 35 * 1024 ** 3 });
    expect(await store.transition(created.id, ["APPROVED"], { status: "SENT" })).toBe(false);
    expect(await store.transition(created.id, ["PROPOSED"], { status: "CANCELLED", completedAt: new Date() })).toBe(true);
    expect((await store.findById(created.id))?.status).toBe("CANCELLED");
  });
});
