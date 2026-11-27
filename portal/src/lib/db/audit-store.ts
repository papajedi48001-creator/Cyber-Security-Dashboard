import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuditRecord, AuditStore, NewAuditRecord } from "../audit";
import type { AuditQuery, AuditQueryStore } from "../audit-reader";

type Db = PrismaClient | Prisma.TransactionClient;

export class PrismaAuditStore implements AuditStore, AuditQueryStore {
  constructor(private readonly db: Db) {}

  async append(record: NewAuditRecord): Promise<AuditRecord> {
    const row = await this.db.auditRecord.create({
      data: { ...record, metadata: (record.metadata ?? undefined) as Prisma.InputJsonValue | undefined },
    });
    return { ...row, metadata: (row.metadata as Record<string, unknown> | null) ?? null };
  }

  async query({ limit, before, actionPrefix }: AuditQuery): Promise<AuditRecord[]> {
    const rows = await this.db.auditRecord.findMany({
      where: {
        ...(actionPrefix ? { action: { startsWith: actionPrefix } } : {}),
        ...(before ? { OR: [{ at: { lt: before.at } }, { at: before.at, id: { lt: before.id } }] } : {}),
      },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map((row) => ({ ...row, metadata: (row.metadata as Record<string, unknown> | null) ?? null }));
  }
}
