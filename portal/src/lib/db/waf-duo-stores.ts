import type { PrismaClient } from "@prisma/client";
import type { RawWafSummary } from "../cloudflare/client";
import type { WafSnapshot, WafStore } from "../cloudflare/service";
import type { DuoCheckStore, DuoManualCheck } from "../duo/manual-check";

const CONNECTOR = "cloudflare";

export class PrismaWafStore implements WafStore {
  constructor(private readonly db: PrismaClient) {}

  async latest(): Promise<WafSnapshot | null> {
    const row = await this.db.cloudflareWafSnapshot.findFirst({ orderBy: { fetchedAt: "desc" } });
    return row ? { fetchedAt: row.fetchedAt, since: row.since, until: row.until, summary: row.summary as unknown as RawWafSummary } : null;
  }

  async save(snapshot: WafSnapshot) {
    await this.db.cloudflareWafSnapshot.create({ data: { ...snapshot, summary: snapshot.summary as object } });
    // Keep 30 days of hourly summaries.
    await this.db.cloudflareWafSnapshot.deleteMany({ where: { fetchedAt: { lt: new Date(snapshot.fetchedAt.getTime() - 30 * 86_400_000) } } });
  }

  async recordAttempt(at: Date, error: string | null) {
    const data = { lastAttemptAt: at, lastError: error, ...(error ? {} : { lastSuccessAt: at }) };
    await this.db.connectorState.upsert({ where: { name: CONNECTOR }, update: data, create: { name: CONNECTOR, ...data } });
  }

  async lastAttempt() {
    const row = await this.db.connectorState.findUnique({ where: { name: CONNECTOR } });
    return { at: row?.lastAttemptAt ?? null, error: row?.lastError ?? null };
  }
}

export class PrismaDuoCheckStore implements DuoCheckStore {
  constructor(private readonly db: PrismaClient) {}

  add(check: Omit<DuoManualCheck, "id">) {
    return this.db.duoManualCheck.create({ data: check, omit: { recordedAt: true } });
  }

  recent(limit: number) {
    return this.db.duoManualCheck.findMany({ orderBy: { checkedAt: "desc" }, take: limit, omit: { recordedAt: true } });
  }
}
