// Executive Summary view model (Plan 3 Task 4). Built on the server from
// count-only inputs, so restricted fields (addresses, usernames, titles, paths,
// vulnerability detail) never reach the executive page, even hidden.

import type { PrismaClient } from "@prisma/client";
import { requirePermission, type Principal } from "../auth/authorize";
import type { Services } from "../server/context";
import { loadSourceOverview } from "../sources";
import type { Severity } from "../wazuh/normalize-alert";
import { loadSummary, type IncidentSummary } from "./incident-summary";

export type DataState = "fresh" | "stale" | "error" | "unavailable" | "missing";

export interface ExecutiveInputs {
  incidents: IncidentSummary;
  backups: { jobs: number; ok: number; needsAttention: number; recoveryVerified: number };
  waf: { status: DataState; total: number | null; blocked: number | null };
  duo: { lastCheckedAt: Date | null; overdue: boolean; issuesFound: boolean | null };
  ports: { scanStatus: DataState; unapprovedExposures: number; highRiskExposures: number; restrictedEgressPorts: number };
}

export interface ExecutiveSummary {
  period: { start: Date; end: Date };
  incidents: {
    open: Record<Severity, number>;
    openedThisPeriod: Record<Severity, number>;
    closedThisPeriod: number;
    acknowledgedOnTimePercent: number | null;
    acknowledgementsBreached: number;
  };
  monitoring: { sourcesHealthy: number; sourcesStale: number; sourcesUnknown: number; notificationFailures: number };
  backups: ExecutiveInputs["backups"];
  web: { sampled: true; state: DataState; events: number | null; blocked: number | null };
  duo: { manual: true; lastCheckedAt: Date | null; overdue: boolean; issuesFound: boolean | null };
  ports: ExecutiveInputs["ports"];
  /** Plain-language items that need management attention. */
  attention: string[];
}

export function buildExecutiveSummary(input: ExecutiveInputs, now: Date): ExecutiveSummary {
  const i = input.incidents;
  const attention: string[] = [];
  if (i.open.P1 + i.open.P2 > 0) attention.push(`มี incident ระดับวิกฤตหรือสูงที่ยังไม่ปิด ${i.open.P1 + i.open.P2} รายการ`);
  if (i.acknowledgementsBreached > 0) attention.push(`รับทราบ incident เกินเวลาที่กำหนด ${i.acknowledgementsBreached} รายการในเดือนนี้`);
  if (i.sources.stale + i.sources.unknown > 0)
    attention.push(`แหล่ง Log ขาดหายหรือไม่ทราบสถานะ ${i.sources.stale + i.sources.unknown} แหล่ง ข้อมูลส่วนนี้จึงไม่ครบ`);
  if (i.notificationFailures > 0) attention.push(`การแจ้งเตือนส่งไม่สำเร็จ ${i.notificationFailures} รายการ`);
  if (input.backups.needsAttention > 0) attention.push(`งาน backup ต้องตรวจสอบ ${input.backups.needsAttention} งาน`);
  if (input.backups.recoveryVerified < input.backups.jobs)
    attention.push(`งาน backup ที่ยังไม่ยืนยันว่ากู้คืนได้ ${input.backups.jobs - input.backups.recoveryVerified} งาน`);
  if (input.ports.scanStatus !== "fresh") attention.push("ผลสแกนพอร์ตจากภายนอกไม่เป็นปัจจุบัน จึงยังไม่ทราบสถานะพอร์ตที่เปิด");
  if (input.ports.unapprovedExposures > 0) attention.push(`พอร์ตเปิดสู่ Internet โดยไม่ได้รับอนุมัติ ${input.ports.unapprovedExposures} รายการ`);
  if (input.ports.restrictedEgressPorts > 0) attention.push(`มีการเชื่อมต่อออกไปยังพอร์ตที่ห้าม ${input.ports.restrictedEgressPorts} พอร์ต`);
  if (input.duo.overdue) attention.push("การตรวจ Duo ด้วยมือเลยกำหนด");
  if (input.waf.status !== "fresh") attention.push("ข้อมูล Cloudflare WAF ไม่เป็นปัจจุบันหรือดึงไม่สำเร็จ");

  return {
    period: { start: i.periodStart, end: now },
    incidents: {
      open: i.open,
      openedThisPeriod: i.openedThisPeriod,
      closedThisPeriod: i.closedThisPeriod,
      acknowledgedOnTimePercent: i.acknowledgedOnTimeRate === null ? null : Math.round(i.acknowledgedOnTimeRate * 100),
      acknowledgementsBreached: i.acknowledgementsBreached,
    },
    monitoring: {
      sourcesHealthy: i.sources.healthy,
      sourcesStale: i.sources.stale,
      sourcesUnknown: i.sources.unknown,
      notificationFailures: i.notificationFailures,
    },
    backups: { ...input.backups },
    web: { sampled: true, state: input.waf.status, events: input.waf.total, blocked: input.waf.blocked },
    duo: { manual: true, ...input.duo },
    ports: { ...input.ports },
    attention,
  };
}

/** Server-side loader for the executive page; every part checks executive.read. */
export async function getExecutiveSummary(
  actor: Principal,
  deps: {
    db: PrismaClient;
    pollIntervalSeconds: number;
    services: Pick<Services, "backups" | "waf" | "duo" | "ports">;
  },
  now = new Date(),
): Promise<ExecutiveSummary> {
  requirePermission(actor, "executive.read");
  const sources = await loadSourceOverview(deps.db, deps.pollIntervalSeconds, now);
  const [incidents, backups, waf, duo, ports] = await Promise.all([
    loadSummary(deps.db, sources.sources.map(({ status }) => ({ status })), now),
    deps.services.backups.backupSummary(actor),
    deps.services.waf.executiveWafStatus(actor),
    deps.services.duo.executiveStatus(actor),
    deps.services.ports.executivePortStatus(actor),
  ]);
  return buildExecutiveSummary({ incidents, backups, waf, duo, ports }, now);
}
