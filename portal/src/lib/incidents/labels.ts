import type { SlaState } from "./sla";

export const SLA_LABELS: Record<SlaState, { text: string; className: string }> = {
  met: { text: "ทัน SLA", className: "state-ok" },
  pending: { text: "ยังไม่ถึงกำหนด", className: "muted" },
  due_soon: { text: "ใกล้ครบกำหนด", className: "state-warn" },
  breached: { text: "เกิน SLA", className: "state-bad" },
};
