// Aggregates for the Overview (operators) and the Executive Summary. The
// executive view carries counts only: no titles, systems, addresses or people.

import { slaState } from "../incidents/sla";
import type { Severity } from "../wazuh/normalize-alert";

export interface IncidentFacts {
  severity: Severity;
  status: string;
  detectedAt: Date;
  acknowledgeDue: Date;
  acknowledgedAt: Date | null;
  closedAt: Date | null;
}

const SEVERITIES: Severity[] = ["P1", "P2", "P3", "P4"];
const bySeverity = () => Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;

/** First instant of the current month in Asia/Bangkok, as UTC. */
export function bangkokMonthStart(now: Date): Date {
  const local = new Date(now.getTime() + 7 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 7 * 3_600_000);
}

export interface ExecutiveSummary {
  periodStart: Date;
  open: Record<Severity, number>;
  openedThisPeriod: Record<Severity, number>;
  closedThisPeriod: number;
  /** Share of incidents due for acknowledgement this period that were acknowledged in time; null when none were due. */
  acknowledgedOnTimeRate: number | null;
  acknowledgementsBreached: number;
  sources: { healthy: number; stale: number; unknown: number };
  notificationFailures: number;
}

export function summarize(
  incidents: IncidentFacts[],
  sources: { status: "healthy" | "stale" | "unknown" }[],
  notificationFailures: number,
  now: Date,
): ExecutiveSummary {
  const periodStart = bangkokMonthStart(now);
  const open = bySeverity();
  const openedThisPeriod = bySeverity();
  let closedThisPeriod = 0;
  let due = 0;
  let met = 0;
  let breached = 0;
  for (const i of incidents) {
    if (i.status !== "CLOSED") open[i.severity]++;
    if (i.detectedAt >= periodStart) openedThisPeriod[i.severity]++;
    if (i.closedAt && i.closedAt >= periodStart) closedThisPeriod++;
    if (i.acknowledgeDue >= periodStart && i.acknowledgeDue <= now) {
      due++;
      const state = slaState(i, now);
      if (state === "met") met++;
      if (state === "breached") breached++;
    }
  }
  const count = (status: "healthy" | "stale" | "unknown") => sources.filter((s) => s.status === status).length;
  return {
    periodStart,
    open,
    openedThisPeriod,
    closedThisPeriod,
    acknowledgedOnTimeRate: due ? met / due : null,
    acknowledgementsBreached: breached,
    sources: { healthy: count("healthy"), stale: count("stale"), unknown: count("unknown") },
    notificationFailures,
  };
}

/** Loads only what the summary needs, then aggregates. */
export async function loadSummary(
  db: import("@prisma/client").PrismaClient,
  sources: { status: "healthy" | "stale" | "unknown" }[],
  now = new Date(),
): Promise<ExecutiveSummary> {
  const periodStart = bangkokMonthStart(now);
  const incidents = await db.incident.findMany({
    where: {
      OR: [
        { status: { not: "CLOSED" } },
        { detectedAt: { gte: periodStart } },
        { closedAt: { gte: periodStart } },
        { acknowledgeDue: { gte: periodStart } },
      ],
    },
    select: { severity: true, status: true, detectedAt: true, acknowledgeDue: true, acknowledgedAt: true, closedAt: true },
  });
  const notificationFailures = await db.notificationDelivery.count({ where: { status: { in: ["FAILED", "ESCALATED"] } } });
  return summarize(incidents, sources, notificationFailures, now);
}
