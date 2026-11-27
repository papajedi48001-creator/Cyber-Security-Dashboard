// Maps each monitored area to one triage level for the overview board.
// Rule from CLAUDE.md: missing or stale data is "unknown", never "ok".

export type TriageLevel = "act" | "check" | "unknown" | "ok";

export interface Triage {
  level: TriageLevel;
  text: string;
}

export const TRIAGE_LABELS: Record<TriageLevel, string> = {
  act: "ต้องดำเนินการ",
  check: "ควรตรวจ",
  unknown: "ไม่ทราบสถานะ",
  ok: "ปกติ",
};

type Severity = "P1" | "P2" | "P3" | "P4";

export function incidentsTriage({ open, attention }: { open: Record<Severity, number>; attention: number }): Triage {
  const total = open.P1 + open.P2 + open.P3 + open.P4;
  if (attention > 0) return { level: "act", text: `ใกล้ครบหรือเกิน SLA ${attention} รายการ` };
  if (open.P1 > 0) return { level: "act", text: `P1 ยังไม่ปิด ${open.P1} รายการ` };
  if (total > 0) return { level: "check", text: `ยังไม่ปิด ${total} รายการ อยู่ในกำหนด SLA` };
  return { level: "ok", text: "ไม่มี incident ที่ยังไม่ปิด" };
}

export function sourcesTriage({
  connectorFresh,
  statuses,
}: {
  connectorFresh: boolean;
  statuses: ("healthy" | "stale" | "unknown")[];
}): Triage {
  if (!connectorFresh) return { level: "unknown", text: "ดึงข้อมูลจาก Wazuh ไม่เป็นปัจจุบัน" };
  if (statuses.length === 0) return { level: "unknown", text: "ยังไม่ได้ลงทะเบียนแหล่ง Log" };
  const stale = statuses.filter((s) => s === "stale").length;
  const unknown = statuses.filter((s) => s === "unknown").length;
  if (stale > 0) return { level: "act", text: `ขาดหาย ${stale} จาก ${statuses.length} แหล่ง` };
  if (unknown > 0) return { level: "unknown", text: `ไม่ทราบสถานะ ${unknown} จาก ${statuses.length} แหล่ง` };
  return { level: "ok", text: `ส่งข้อมูลตามเกณฑ์ครบ ${statuses.length} แหล่ง` };
}

export function backupsTriage({
  healths,
  unverified,
}: {
  healths: ("ok" | "failing" | "stale" | "unencrypted" | "unknown")[];
  unverified: number;
}): Triage {
  if (healths.length === 0) return { level: "unknown", text: "ยังไม่มีงาน backup ที่ติดตาม" };
  const bad = healths.filter((h) => h === "failing" || h === "stale" || h === "unencrypted").length;
  if (bad > 0) return { level: "act", text: `มีปัญหา ${bad} จาก ${healths.length} งาน` };
  const unknown = healths.filter((h) => h === "unknown").length;
  if (unknown > 0) return { level: "unknown", text: `ไม่มีข้อมูล ${unknown} จาก ${healths.length} งาน` };
  if (unverified > 0) return { level: "check", text: `สำรองตามรอบ แต่ยังไม่ยืนยันการกู้คืน ${unverified} งาน` };
  return { level: "ok", text: `สำรองตามรอบและทดสอบกู้คืนแล้ว ${healths.length} งาน` };
}

export function portsTriage({
  scanStatus,
  openExposures,
}: {
  scanStatus: "fresh" | "stale" | "missing";
  openExposures: number;
}): Triage {
  if (openExposures > 0) return { level: "act", text: `เปิดโดยไม่ได้รับอนุมัติ ${openExposures} รายการ` };
  if (scanStatus !== "fresh") return { level: "unknown", text: "ไม่มีผลสแกนที่เป็นปัจจุบัน" };
  return { level: "ok", text: "ผลสแกนล่าสุดไม่พบพอร์ตที่ไม่ได้รับอนุมัติ" };
}

export function wafTriage({ status }: { status: "fresh" | "stale" | "error" | "unavailable" }): Triage {
  if (status === "fresh") return { level: "ok", text: "ข้อมูลสุ่มตัวอย่างเป็นปัจจุบัน" };
  if (status === "stale") return { level: "unknown", text: "ข้อมูลไม่เป็นปัจจุบัน" };
  return { level: "unknown", text: status === "error" ? "ดึงข้อมูลไม่สำเร็จ" : "ยังไม่มีข้อมูล" };
}

export function duoTriage({ state }: { state: "current" | "overdue" | "never_checked" }): Triage {
  if (state === "current") return { level: "ok", text: "ตรวจด้วยมือตามรอบ" };
  if (state === "overdue") return { level: "check", text: "เลยกำหนดตรวจด้วยมือ" };
  return { level: "unknown", text: "ยังไม่เคยตรวจ" };
}

export function notificationsTriage({ channels, failures }: { channels: number; failures: number }): Triage {
  if (channels === 0) return { level: "act", text: "ยังไม่ได้ตั้งค่าช่องทางแจ้งเตือน" };
  if (failures > 0) return { level: "act", text: `ส่งไม่สำเร็จ ${failures} รายการ` };
  return { level: "ok", text: `ส่งได้ปกติ ${channels} ช่องทาง` };
}
