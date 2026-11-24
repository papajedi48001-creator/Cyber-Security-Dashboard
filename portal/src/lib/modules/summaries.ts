// Per-module overview summaries. Each maps what the module's service already
// computes (including its own freshness rules) onto a ModuleSummary.

import type { BackupJobStatus } from "@/lib/backups/status";
import type { SampledWafSummary } from "@/lib/cloudflare/service";
import type { ExposureSnapshot } from "@/lib/port-monitor/service";
import type { SourceOverview } from "@/lib/sources";
import type { ModuleSummary } from "./overview";

type Severity = "P1" | "P2" | "P3" | "P4";

export function incidentsSummary(open: Record<Severity, number>, needingAttention: number): ModuleSummary {
  const total = open.P1 + open.P2 + open.P3 + open.P4;
  const detail = (["P1", "P2", "P3", "P4"] as const).map((s) => `${s} ${open[s]}`).join(" · ");
  if (total === 0) return { health: "ok", headline: "ไม่มี incident ที่ยังไม่ปิด", detail, asOf: null };
  const health = open.P1 > 0 || needingAttention > 0 ? "bad" : "warn";
  const attention = needingAttention > 0 ? ` · SLA ใกล้ครบหรือเกิน ${needingAttention}` : "";
  return { health, headline: `ยังไม่ปิด ${total} รายการ`, detail: detail + attention, asOf: null };
}

export function assetsSummary(total: number, critical: number): ModuleSummary {
  if (total === 0) return { health: "warn", headline: "ยังไม่ได้ลงทะเบียนทรัพย์สิน", detail: "", asOf: null };
  return { health: "ok", headline: `${total} รายการ`, detail: `ทรัพย์สินสำคัญ ${critical} รายการ`, asOf: null };
}

export function logSourcesSummary(overview: SourceOverview): ModuleSummary {
  const { connector, sources } = overview;
  if (!connector.lastSuccessAt) return { health: "waiting", headline: "รอข้อมูล", detail: connector.reason, asOf: null };
  if (connector.status !== "fresh") return { health: "stale", headline: "ข้อมูลเก่า", detail: connector.reason, asOf: connector.lastSuccessAt };
  const silent = sources.filter((s) => s.status === "stale").length;
  const unknown = sources.filter((s) => s.status === "unknown").length;
  if (silent > 0) return { health: "bad", headline: `เงียบ ${silent} แหล่ง`, detail: `จาก ${sources.length} แหล่ง`, asOf: connector.lastSuccessAt };
  if (unknown > 0)
    return { health: "warn", headline: `ไม่ทราบสถานะ ${unknown} แหล่ง`, detail: `จาก ${sources.length} แหล่ง`, asOf: connector.lastSuccessAt };
  return { health: "ok", headline: "ทุกแหล่งส่งข้อมูลตามเกณฑ์", detail: `${sources.length} แหล่ง`, asOf: connector.lastSuccessAt };
}

export function cloudBackupSummary(jobs: BackupJobStatus[]): ModuleSummary {
  if (jobs.length === 0) return { health: "waiting", headline: "รอข้อมูล", detail: "ยังไม่มีงาน backup ที่ติดตาม", asOf: null };
  const problems = jobs.filter((j) => j.health !== "ok").length;
  const unverified = jobs.filter((j) => j.recovery !== "verified").length;
  const detail = `${jobs.length} งาน · ยังไม่ยืนยันการกู้คืน ${unverified}`;
  if (problems > 0) return { health: "bad", headline: `มีปัญหา ${problems} งาน`, detail, asOf: null };
  if (unverified > 0) return { health: "warn", headline: "สำรองตามรอบ", detail, asOf: null };
  return { health: "ok", headline: "ทุกงานสำรองตามรอบ", detail, asOf: null };
}

export function portExposureSummary(snap: ExposureSnapshot): ModuleSummary {
  const { scan } = snap;
  if (scan.status === "missing") return { health: "waiting", headline: "รอข้อมูล", detail: scan.reason, asOf: null };
  if (scan.status === "stale") return { health: "stale", headline: "ข้อมูลเก่า", detail: scan.reason, asOf: scan.at };
  const open = snap.exposures.filter((f) => f.classification === "UNAPPROVED" || f.classification === "EXCEPTION_EXPIRED").length;
  if (open > 0) return { health: "bad", headline: `เปิดโดยไม่ได้รับอนุมัติ ${open} รายการ`, detail: scan.reason, asOf: scan.at };
  return { health: "ok", headline: "ไม่มีพอร์ตที่เปิดโดยไม่ได้รับอนุมัติ", detail: scan.reason, asOf: scan.at };
}

export function wafSummary(waf: SampledWafSummary): ModuleSummary {
  switch (waf.status) {
    case "unavailable":
      return { health: "waiting", headline: "รอข้อมูล", detail: waf.reason, asOf: null };
    case "error":
      return { health: "bad", headline: "ดึงข้อมูลไม่สำเร็จ", detail: waf.reason, asOf: waf.fetchedAt };
    case "stale":
      return { health: "stale", headline: "ข้อมูลเก่า", detail: waf.reason, asOf: waf.fetchedAt };
    case "fresh":
      return { health: "ok", headline: `${waf.total ?? 0} เหตุการณ์ (sampled)`, detail: waf.reason, asOf: waf.fetchedAt };
  }
}

export function duoSummary(status: { state: string; last: { checkedAt: Date; issuesFound: boolean } | null }): ModuleSummary {
  if (!status.last) return { health: "waiting", headline: "รอข้อมูล", detail: "ยังไม่เคยตรวจ", asOf: null };
  if (status.state === "overdue") return { health: "warn", headline: "เลยกำหนดตรวจ", detail: "ตรวจด้วยมือ", asOf: null };
  if (status.last.issuesFound) return { health: "warn", headline: "พบประเด็นในการตรวจล่าสุด", detail: "ตรวจด้วยมือ", asOf: null };
  return { health: "ok", headline: "ตรวจตามกำหนด", detail: "ตรวจด้วยมือ", asOf: null };
}

export const executiveSummaryTile: ModuleSummary = {
  health: "ok",
  headline: "รายงานสรุปประจำเดือน",
  detail: "Incident, แหล่ง Log, Backup และพอร์ต",
  asOf: null,
};
