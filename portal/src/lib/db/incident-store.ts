import { Prisma, type PrismaClient } from "@prisma/client";
import type { Role } from "../auth/authorize";
import type {
  ClosureEvidence,
  Incident,
  IncidentFilter,
  IncidentPatch,
  IncidentStatus,
  IncidentStore,
  LinkedAlert,
  NewIncident,
  NewTimelineEntry,
  TimelineEntry,
} from "../incidents/service";
import type { Category } from "../wazuh/normalize-alert";

const ACTIVE: IncidentStatus[] = ["NEW", "ASSIGNED", "ACKNOWLEDGED", "INVESTIGATING"];
const OWNER_ROLES: Role[] = ["SECURITY_ADMINISTRATOR", "SECURITY_OPERATOR"];
const alertSelect = {
  wazuhAlertId: true, ruleId: true, ruleLevel: true, category: true, description: true, sourceName: true,
  detectedAt: true, investigationUrl: true, incidentId: true,
} as const;

type AlertRow = Prisma.AlertReferenceGetPayload<{ select: typeof alertSelect }>;
const toAlert = (row: AlertRow): LinkedAlert => ({ ...row, category: row.category as Category });
const toEvidence = (row: Prisma.ClosureEvidenceGetPayload<object>): ClosureEvidence => ({
  ...row,
  decision: row.decision as ClosureEvidence["decision"],
});

export class PrismaIncidentStore implements IncidentStore {
  constructor(private readonly db: PrismaClient) {}

  async create(data: NewIncident, year: number, entry: NewTimelineEntry): Promise<Incident> {
    const prefix = `INC-${year}-`;
    // The unique index on number settles concurrent creators; the loser retries.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(async (tx) => {
          const last = await tx.incident.findFirst({
            where: { number: { startsWith: prefix } },
            orderBy: { number: "desc" },
            select: { number: true },
          });
          const seq = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
          const incident = await tx.incident.create({
            data: { ...data, number: `${prefix}${String(seq).padStart(4, "0")}` },
          });
          await tx.incidentTimelineEntry.create({ data: { ...entry, incidentId: incident.id } });
          return incident;
        });
      } catch (error) {
        const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
        if (!duplicate || attempt >= 4) throw error;
      }
    }
  }

  findById(id: string) {
    return this.db.incident.findUnique({ where: { id } });
  }

  list(filter: IncidentFilter) {
    return this.db.incident.findMany({
      where: {
        ...(filter.view === "closed" ? { status: "CLOSED" } : filter.view === "all" ? {} : { status: { not: "CLOSED" } }),
        ...(filter.severity ? { severity: filter.severity } : {}),
        ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
      },
      orderBy: [{ severity: "asc" }, { detectedAt: "desc" }],
      take: 500,
    });
  }

  async applyChange(id: string, expected: IncidentStatus, patch: IncidentPatch, entry: NewTimelineEntry) {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.incident.updateMany({ where: { id, status: expected }, data: patch });
      if (count === 0) return null;
      await tx.incidentTimelineEntry.create({ data: { ...entry, incidentId: id } });
      return tx.incident.findUnique({ where: { id } });
    });
  }

  async addTimeline(incidentId: string, entry: NewTimelineEntry) {
    await this.db.incidentTimelineEntry.create({ data: { ...entry, incidentId } });
  }

  listTimeline(incidentId: string): Promise<TimelineEntry[]> {
    return this.db.incidentTimelineEntry.findMany({ where: { incidentId }, orderBy: { at: "asc" } });
  }

  findActiveGroup(category: string, sourceName: string) {
    return this.db.incident.findFirst({
      where: { category, sourceName, status: { in: ACTIVE } },
      orderBy: { detectedAt: "desc" },
    });
  }

  async findAlert(wazuhAlertId: string) {
    const row = await this.db.alertReference.findUnique({ where: { wazuhAlertId }, select: alertSelect });
    return row ? toAlert(row) : null;
  }

  async linkAlerts(incidentId: string, wazuhAlertIds: string[]) {
    await this.db.alertReference.updateMany({
      where: { wazuhAlertId: { in: wazuhAlertIds }, incidentId: null },
      data: { incidentId },
    });
  }

  async alerts(incidentId: string) {
    const rows = await this.db.alertReference.findMany({
      where: { incidentId },
      orderBy: { detectedAt: "asc" },
      take: 200,
      select: alertSelect,
    });
    return rows.map(toAlert);
  }

  async addEvidence(data: Omit<ClosureEvidence, "id" | "reviewedById" | "reviewedAt" | "decision" | "reviewNote">) {
    return toEvidence(await this.db.closureEvidence.create({ data }));
  }

  async latestEvidence(incidentId: string) {
    const row = await this.db.closureEvidence.findFirst({ where: { incidentId }, orderBy: { submittedAt: "desc" } });
    return row ? toEvidence(row) : null;
  }

  async reviewEvidence(id: string, review: Pick<ClosureEvidence, "reviewedById" | "reviewedAt" | "decision" | "reviewNote">) {
    await this.db.closureEvidence.update({ where: { id }, data: review });
  }

  findAssignee(userId: string) {
    return this.db.user.findFirst({
      where: { id: userId, active: true, role: { in: OWNER_ROLES } },
      select: { id: true, role: true },
    });
  }

  listAssignees() {
    return this.db.user.findMany({
      where: { active: true, role: { in: OWNER_ROLES } },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    });
  }

  async listSecurityEvents(limit: number) {
    const rows = await this.db.alertReference.findMany({
      where: { incidentId: null },
      orderBy: { detectedAt: "desc" },
      take: limit,
      select: alertSelect,
    });
    return rows.map(toAlert);
  }
}
