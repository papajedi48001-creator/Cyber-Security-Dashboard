// Duo Manual Check (spec "Duo"): an operator reviews the Duo Admin Panel and
// records a structured result. The Portal shows who checked and when; it never
// presents this as live monitoring. A Duo Admin API connector waits for a
// confirmed entitlement (Phase 4).

import type { AuditLog } from "../audit";
import { requirePermission, type Principal } from "../auth/authorize";
import { addWorkingMinutes, DEFAULT_CALENDAR, type WorkingCalendar } from "../incidents/sla";

export interface DuoManualCheck {
  id: string;
  checkedAt: Date;
  checkedById: string;
  checkedByName: string;
  authLogReviewed: boolean;
  adminActionsReviewed: boolean;
  deniedAuthentications: number;
  fraudReports: number;
  bypassUsers: number;
  issuesFound: boolean;
  note: string | null;
}

export interface DuoCheckStore {
  add(check: Omit<DuoManualCheck, "id">): Promise<DuoManualCheck>;
  recent(limit: number): Promise<DuoManualCheck[]>;
}

export class DuoCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuoCheckError";
  }
}

type Actor = Principal & { username: string };

/** One working day (8 hours of working time) after the last check. */
const CHECK_INTERVAL_WORKING_MINUTES = 8 * 60;
const NATIONAL_ID = /(?<!\d)\d{13}(?!\d)/;

function count(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 100_000) throw new DuoCheckError(`${field} ต้องเป็นจำนวนเต็มไม่ติดลบ`);
  return value;
}

export function createDuoManualCheckService({
  store,
  audit,
  clock = () => new Date(),
  calendar = DEFAULT_CALENDAR,
}: {
  store: DuoCheckStore;
  audit: AuditLog;
  clock?: () => Date;
  calendar?: WorkingCalendar;
}) {
  return {
    async recordDuoManualCheck(
      actor: Actor,
      input: {
        checkedAt: Date;
        authLogReviewed: boolean;
        adminActionsReviewed: boolean;
        deniedAuthentications: number;
        fraudReports: number;
        bypassUsers: number;
        note: string | null;
      },
      correlationId: string,
    ) {
      requirePermission(actor, "incident.write");
      if (!input.authLogReviewed || !input.adminActionsReviewed)
        throw new DuoCheckError("ต้องตรวจ Authentication Log และ Administrator Actions ให้ครบก่อนบันทึก");
      if (Number.isNaN(input.checkedAt.getTime()) || input.checkedAt > clock())
        throw new DuoCheckError("เวลาที่ตรวจต้องเป็นเวลาจริงที่ไม่อยู่ในอนาคต");
      const note = input.note?.trim() || null;
      if (note && (note.length > 1000 || NATIONAL_ID.test(note))) throw new DuoCheckError("บันทึกยาวเกินหรือมีข้อมูลส่วนบุคคล");
      const deniedAuthentications = count(input.deniedAuthentications, "จำนวนการยืนยันตัวตนที่ถูกปฏิเสธ");
      const fraudReports = count(input.fraudReports, "จำนวน Fraud report");
      const bypassUsers = count(input.bypassUsers, "จำนวนผู้ใช้สถานะ bypass");
      const check = await store.add({
        checkedAt: input.checkedAt,
        checkedById: actor.id,
        checkedByName: actor.username,
        authLogReviewed: true,
        adminActionsReviewed: true,
        deniedAuthentications,
        fraudReports,
        bypassUsers,
        issuesFound: deniedAuthentications > 0 || fraudReports > 0 || bypassUsers > 0,
        note,
      });
      await audit.append({
        actor: { id: actor.id, label: actor.username },
        action: "duo.manual_check_recorded",
        target: { type: "DuoManualCheck", id: check.id },
        metadata: { checkedAt: check.checkedAt.toISOString(), fraudReports, bypassUsers, deniedAuthentications },
        correlationId,
      });
      return check;
    },

    async getStatus(actor: Principal) {
      requirePermission(actor, "evidence.read");
      const history = await store.recent(30);
      const last = history[0] ?? null;
      const nextDueAt = last ? addWorkingMinutes(last.checkedAt, CHECK_INTERVAL_WORKING_MINUTES, calendar) : null;
      const state = !last ? "never_checked" : clock() > nextDueAt! ? "overdue" : "current";
      return { mode: "manual" as const, state, last, nextDueAt, history };
    },

    /** Counts only, for the executive summary. */
    async executiveStatus(actor: Principal) {
      requirePermission(actor, "executive.read");
      const last = (await store.recent(1))[0] ?? null;
      const nextDueAt = last ? addWorkingMinutes(last.checkedAt, CHECK_INTERVAL_WORKING_MINUTES, calendar) : null;
      return {
        lastCheckedAt: last?.checkedAt ?? null,
        overdue: !last || clock() > nextDueAt!,
        issuesFound: last?.issuesFound ?? null,
      };
    },
  };
}

export type DuoManualCheckService = ReturnType<typeof createDuoManualCheckService>;

/** Test and development store. */
export class InMemoryDuoCheckStore implements DuoCheckStore {
  checks: DuoManualCheck[] = [];
  async add(check: Omit<DuoManualCheck, "id">) {
    const created = { ...check, id: `duo-${this.checks.length + 1}` };
    this.checks.push(created);
    return created;
  }
  async recent(limit: number) {
    return [...this.checks].sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime()).slice(0, limit);
  }
}
