import { Prisma, type PrismaClient } from "@prisma/client";
import type { DeliveryPatch, DeliveryRow, DeliveryStore, NewDelivery } from "../notifications/delivery";

const include = { incident: { select: { number: true } } } as const;
type Row = Prisma.NotificationDeliveryGetPayload<{ include: typeof include }>;
const toRow = ({ incident, ...row }: Row): DeliveryRow => ({ ...row, incidentNumber: incident.number });

export class PrismaDeliveryStore implements DeliveryStore {
  constructor(private readonly db: PrismaClient) {}

  async insertIfAbsent({ incidentNumber: _number, ...row }: NewDelivery) {
    try {
      await this.db.notificationDelivery.create({ data: row });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  }

  async due(now: Date, limit: number) {
    const rows = await this.db.notificationDelivery.findMany({
      where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
      include,
    });
    return rows.map(toRow);
  }

  async update(id: string, patch: DeliveryPatch) {
    await this.db.notificationDelivery.update({ where: { id }, data: patch });
  }

  async openFailures() {
    const rows = await this.db.notificationDelivery.findMany({
      where: { status: { in: ["FAILED", "ESCALATED"] } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include,
    });
    return rows.map(toRow);
  }
}
