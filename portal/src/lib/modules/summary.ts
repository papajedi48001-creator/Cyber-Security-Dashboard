// Overview tiles (ADR 0011): each module reduces its own state to one health
// value, a headline and a detail line. Missing data is "waiting" and old data
// is "stale"; neither ever renders as healthy or as zero.

export type ModuleHealth = "ok" | "warn" | "bad" | "stale" | "waiting";

export interface ModuleSummary {
  health: ModuleHealth;
  headline: string;
  detail: string;
  asOf: Date | null;
}

export const HEALTH_LABELS: Record<ModuleHealth, string> = {
  ok: "ปกติ",
  warn: "ควรตรวจ",
  bad: "ต้องดำเนินการ",
  stale: "ข้อมูลเก่า",
  waiting: "รอข้อมูล",
};

const waiting = (detail: string): ModuleSummary => ({ health: "waiting", headline: "รอข้อมูล", detail, asOf: null });
const stale = (detail: string, asOf: Date | null): ModuleSummary => ({ health: "stale", headline: "ข้อมูลเก่า", detail, asOf });

type Severities = { P1: number; P2: number; P3: number; P4: number };

export function incidentTile(input: { open: Severities; attention: number }): ModuleSummary {
  const total = input.open.P1 + input.open.P2 + input.open.P3 + input.open.P4;
  const detail = `P1 ${input.open.P1} · P2 ${input.open.P2} · P3 ${input.open.P3} · P4 ${input.open.P4}`;
  if (total === 0) return { health: "ok", headline: "ไม่มี incident เปิดอยู่", detail, asOf: new Date() };
  const health = input.open.P1 > 0 ? "bad" : input.attention > 0 || input.open.P2 > 0 ? "warn" : "ok";
  const attention = input.attention > 0 ? ` · ใกล้หรือเกิน SLA ${input.attention}` : "";
  return { health, headline: `เปิดอยู่ ${total} รายการ`, detail: detail + attention, asOf: new Date() };
}

export function logSourceTile(input: {
  connector: { status: "fresh" | "stale"; reason: string; lastSuccessAt?: Date | null };
  total: number;
  unhealthy: number;
}): ModuleSummary {
  if (input.connector.status === "stale") return stale(input.connector.reason, input.connector.lastSuccessAt ?? null);
  if (input.total === 0) return waiting("ยังไม่มีแหล่ง Log ที่ลงทะเบียน");
  const asOf = input.connector.lastSuccessAt ?? null;
  if (input.unhealthy > 0)
    return { health: "warn", headline: `ผิดปกติ ${input.unhealthy} จาก ${input.total} แหล่ง`, detail: "บางแหล่งไม่ส่งข้อมูลตามเกณฑ์", asOf };
  return { health: "ok", headline: `ปกติทั้ง ${input.total} แหล่ง`, detail: "ทุกแหล่งส่งข้อมูลตามเกณฑ์", asOf };
}

export function backupTile(input: { jobs: number; problems: number; unverified: number }): ModuleSummary {
  if (input.jobs === 0) return waiting("ยังไม่มีงาน backup ที่ติดตาม");
  if (input.problems > 0)
    return { health: "bad", headline: `มีปัญหา ${input.problems} จาก ${input.jobs} งาน`, detail: "ล้มเหลว ขาดรอบ หรือไม่ได้เข้ารหัส", asOf: null };
  if (input.unverified > 0)
    return { health: "warn", headline: `สำรองตามรอบทั้ง ${input.jobs} งาน`, detail: `ยังไม่ยืนยันการกู้คืน ${input.unverified} งาน`, asOf: null };
  return { health: "ok", headline: `สำรองตามรอบทั้ง ${input.jobs} งาน`, detail: "ยืนยันการกู้คืนครบ", asOf: null };
}

export function portTile(input: {
  scan: { status: "fresh" | "stale" | "missing"; reason: string; at: Date | null };
  unapproved: number;
}): ModuleSummary {
  if (input.scan.status === "missing") return waiting(input.scan.reason);
  if (input.scan.status === "stale") return stale(input.scan.reason, input.scan.at);
  if (input.unapproved > 0)
    return { health: "bad", headline: `เปิดโดยไม่ได้อนุมัติ ${input.unapproved} รายการ`, detail: input.scan.reason, asOf: input.scan.at };
  return { health: "ok", headline: "ไม่มีพอร์ตเปิดเกินอนุมัติ", detail: input.scan.reason, asOf: input.scan.at };
}

export function wafTile(input: {
  status: "fresh" | "stale" | "error" | "unavailable";
  reason: string;
  fetchedAt: Date | null;
  total: number | null;
}): ModuleSummary {
  if (input.status === "unavailable") return waiting(input.reason);
  if (input.status === "stale") return stale(input.reason, input.fetchedAt);
  if (input.status === "error") return { health: "bad", headline: "ดึงข้อมูลไม่สำเร็จ", detail: input.reason, asOf: input.fetchedAt };
  return {
    health: "ok",
    headline: input.total === null ? "รับข้อมูลปกติ" : `เหตุการณ์ (sampled) ${input.total.toLocaleString("th-TH")}`,
    detail: input.reason,
    asOf: input.fetchedAt,
  };
}

export function duoTile(input: { state: string; lastAt: Date | null }): ModuleSummary {
  if (input.state === "never_checked") return waiting("ยังไม่เคยตรวจ Duo ด้วยมือ");
  if (input.state === "overdue") return { health: "bad", headline: "เลยกำหนดตรวจ", detail: "ตรวจ Authentication Log และ Administrator Actions", asOf: input.lastAt };
  return { health: "ok", headline: "ตรวจตามรอบ", detail: "ตรวจด้วยมือ", asOf: input.lastAt };
}

/** Until Replica Reporters send reports (plan Tasks 6 to 8), the module only waits. */
export function replicaTile(): ModuleSummary {
  return waiting("ยังไม่มีรายงานจาก Replica Reporter");
}
