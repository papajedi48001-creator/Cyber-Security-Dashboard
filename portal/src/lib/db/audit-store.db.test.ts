import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl, testPrisma } from "./test-db";
import { createAuditLog } from "../audit";
import { PrismaAuditStore } from "./audit-store";


describe.skipIf(!testDatabaseUrl)("PrismaAuditStore (MariaDB)", () => {
  const prisma = testPrisma();
  afterAll(() => prisma?.$disconnect());

  it("persists an audit record in UTC", async () => {
    const audit = createAuditLog(new PrismaAuditStore(prisma), () => new Date("2026-10-14T03:00:00Z"));
    const record = await audit.append({
      actor: { id: null, label: "system:test" },
      action: "test.audit_persist",
      target: { type: "Test", id: "t-1" },
      metadata: { step: 1 },
      correlationId: `corr-${Date.now()}`,
    });
    const row = await prisma.auditRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.at.toISOString()).toBe("2026-10-14T03:00:00.000Z");
    expect(row.metadata).toEqual({ step: 1 });
  });

  it("rejects UPDATE and DELETE at the database level", async () => {
    const row = await prisma.auditRecord.create({
      data: { actorLabel: "system:test", action: "test.immutable", targetType: "Test", correlationId: "c" },
    });
    await expect(prisma.auditRecord.update({ where: { id: row.id }, data: { action: "test.changed" } })).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.auditRecord.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});
