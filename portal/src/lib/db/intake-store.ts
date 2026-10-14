import type { PrismaClient } from "@prisma/client";
import type { NormalizedAlert } from "../wazuh/normalize-alert";
import type { ConnectorSnapshot, IntakeStore } from "../wazuh/poller";

export class PrismaIntakeStore implements IntakeStore {
  constructor(private readonly db: PrismaClient) {}

  async getConnector(name: string): Promise<ConnectorSnapshot> {
    const row = await this.db.connectorState.findUnique({ where: { name } });
    return {
      checkpoint: row?.checkpoint ?? null,
      lastAttemptAt: row?.lastAttemptAt ?? null,
      lastSuccessAt: row?.lastSuccessAt ?? null,
      lastError: row?.lastError ?? null,
    };
  }

  async saveConnector(name: string, patch: Partial<ConnectorSnapshot>) {
    await this.db.connectorState.upsert({ where: { name }, update: patch, create: { name, ...patch } });
  }

  async upsertAlerts(alerts: NormalizedAlert[], now: Date) {
    return this.db.$transaction(async (tx) => {
      const created: NormalizedAlert[] = [];
      let duplicates = 0;
      for (const alert of alerts) {
        const existing = await tx.alertReference.findUnique({ where: { wazuhAlertId: alert.wazuhAlertId }, select: { id: true } });
        if (existing) {
          await tx.alertReference.update({
            where: { id: existing.id },
            data: { deliveryCount: { increment: 1 }, lastSeenAt: now },
          });
          duplicates++;
        } else {
          await tx.alertReference.create({ data: { ...alert, firstSeenAt: now, lastSeenAt: now } });
          created.push(alert);
        }
      }
      return { created, duplicates };
    });
  }

  async recordSourceActivity(activity: Map<string, Date>) {
    for (const [name, at] of activity) {
      await this.db.logSource.updateMany({
        where: { name, OR: [{ lastEventAt: null }, { lastEventAt: { lt: at } }] },
        data: { lastEventAt: at },
      });
    }
  }
}
