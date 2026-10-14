import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuditRecord, AuditStore, NewAuditRecord } from "../audit";

type Db = PrismaClient | Prisma.TransactionClient;

export class PrismaAuditStore implements AuditStore {
  constructor(private readonly db: Db) {}

  async append(record: NewAuditRecord): Promise<AuditRecord> {
    const row = await this.db.auditRecord.create({
      data: { ...record, metadata: (record.metadata ?? undefined) as Prisma.InputJsonValue | undefined },
    });
    return { ...row, metadata: (row.metadata as Record<string, unknown> | null) ?? null };
  }
}
