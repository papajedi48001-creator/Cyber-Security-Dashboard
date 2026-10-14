import type { PrismaClient } from "@prisma/client";
import { requirePermission, type Principal } from "./auth/authorize";
import { connectorFreshness, evaluateSourceHealth, type SourceHealth } from "./source-health";
import { CONNECTOR_NAME } from "./wazuh/poller";

export interface SourceOverview {
  connector: ReturnType<typeof connectorFreshness> & { lastSuccessAt: Date | null };
  sources: (SourceHealth & { type: string; expectedIntervalMinutes: number; assetName: string | null })[];
}

export async function getSourceOverview(
  db: PrismaClient,
  actor: Principal,
  pollIntervalSeconds: number,
  now = new Date(),
): Promise<SourceOverview> {
  requirePermission(actor, "source.read");
  const state = await db.connectorState.findUnique({ where: { name: CONNECTOR_NAME } });
  const connector = {
    lastSuccessAt: state?.lastSuccessAt ?? null,
    lastAttemptAt: state?.lastAttemptAt ?? null,
    lastError: state?.lastError ?? null,
  };
  const rows = await db.logSource.findMany({ include: { asset: { select: { name: true } } }, orderBy: { name: "asc" } });
  return {
    connector: { ...connectorFreshness(connector, now, pollIntervalSeconds), lastSuccessAt: connector.lastSuccessAt },
    sources: rows.map((row) => ({
      ...evaluateSourceHealth(row, now, connector, pollIntervalSeconds),
      type: row.type,
      expectedIntervalMinutes: row.expectedIntervalMinutes,
      assetName: row.asset?.name ?? null,
    })),
  };
}
