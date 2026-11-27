// Backup File Management (ADR 0011, spec "Future file lifecycle management"):
// a Backup Lifecycle Request to destroy one HOSxP backup file on GDCC. A
// Security Operator or Administrator proposes, a different Security
// Administrator approves, and a Backup Deletion Hold follows during which the
// request can still be cancelled. Only then does the worker hand a destroy
// instruction to the GDCC job, which re-checks it and reports the outcome.
// The Portal itself never deletes a file and holds no credential that can.

import type { AuditLog } from "../audit";
import { can, ForbiddenError, requirePermission, type Principal } from "../auth/authorize";
import type { FilesView, RequestOutcome } from "./status";

export const DELETION_HOLD_HOURS = 24;
const SYSTEM_ACTOR = "system:gdcc-files";
const NATIONAL_ID = /(?<!\d)\d{13}(?!\d)/;

export type RequestStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "CANCELLED" | "SENT" | "DESTROYED" | "FAILED";
export const OPEN_STATUSES: readonly RequestStatus[] = ["PROPOSED", "APPROVED", "SENT"];

export interface BackupFileRequest {
  id: string;
  fileName: string;
  sizeBytes: number;
  reason: string;
  status: RequestStatus;
  proposedById: string;
  proposedByLabel: string;
  proposedAt: Date;
  decidedById: string | null;
  decidedByLabel: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  holdUntil: Date | null;
  sentAt: Date | null;
  completedAt: Date | null;
  outcome: string | null;
}

export type NewBackupFileRequest = Pick<BackupFileRequest, "fileName" | "sizeBytes" | "reason" | "proposedById" | "proposedByLabel" | "proposedAt">;

export interface BackupFileRequestStore {
  create(request: NewBackupFileRequest): Promise<BackupFileRequest>;
  findById(id: string): Promise<BackupFileRequest | null>;
  /** Newest first. */
  list(limit: number): Promise<BackupFileRequest[]>;
  listByStatus(statuses: readonly RequestStatus[]): Promise<BackupFileRequest[]>;
  /** Applies the change only while the request is still in `from`; false when someone else moved it first. */
  transition(id: string, from: readonly RequestStatus[], change: Partial<BackupFileRequest> & { status: RequestStatus }): Promise<boolean>;
}

/** What the worker writes to the requests outbox, in the GDCC job's format. */
export interface DestroyInstruction {
  id: string;
  action: "destroy";
  file: string;
  size_bytes: number;
  not_before: string;
}

export class BackupFileRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFileRequestError";
  }
}

type Actor = Principal & { username: string };

const utc = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

function note(text: string, required: boolean): string | null {
  const value = text.trim();
  if (required && value.length < 10) throw new BackupFileRequestError("ต้องระบุเหตุผลอย่างน้อย 10 ตัวอักษร");
  if (value.length > 500 || NATIONAL_ID.test(value)) throw new BackupFileRequestError("เหตุผลยาวเกินหรือมีข้อมูลที่ไม่ควรบันทึก");
  return value || null;
}

export function createBackupFileService({
  store,
  audit,
  enabled,
  clock = () => new Date(),
}: {
  store: BackupFileRequestStore;
  audit: AuditLog;
  /** True only when the requests outbox is configured. */
  enabled: boolean;
  clock?: () => Date;
}) {
  const record = (actor: { id: string | null; label: string }, action: string, request: BackupFileRequest, correlationId: string, metadata?: Record<string, unknown>) =>
    audit.append({
      actor,
      action,
      target: { type: "BackupLifecycleRequest", id: request.id },
      metadata: { file: request.fileName, ...metadata },
      correlationId,
    });

  async function load(id: string) {
    const found = await store.findById(id);
    if (!found) throw new BackupFileRequestError("ไม่พบคำขอนี้");
    return found;
  }

  async function move(actor: Actor, id: string, from: readonly RequestStatus[], change: Partial<BackupFileRequest> & { status: RequestStatus }, action: string, correlationId: string) {
    const request = await load(id);
    if (!from.includes(request.status)) throw new BackupFileRequestError("คำขอนี้ไม่อยู่ในสถานะที่ทำรายการนี้ได้แล้ว");
    if (!(await store.transition(id, from, change))) throw new BackupFileRequestError("คำขอนี้ถูกเปลี่ยนสถานะไปก่อนแล้ว");
    const updated = { ...request, ...change };
    await record({ id: actor.id, label: actor.username }, action, updated, correlationId, { status: change.status });
    return updated;
  }

  return {
    enabled,

    async list(actor: Principal) {
      requirePermission(actor, "evidence.read");
      return store.list(100);
    },

    async propose(actor: Actor, input: { fileName: string; reason: string }, view: FilesView, correlationId: string) {
      requirePermission(actor, "backup.record");
      if (!enabled) throw new BackupFileRequestError("ยังไม่ได้เปิดใช้คำขอจัดการไฟล์ backup");
      if (view.state !== "fresh") throw new BackupFileRequestError("สถานะไฟล์จาก GDCC ไม่เป็นปัจจุบัน จึงยังยื่นคำขอไม่ได้");
      const file = view.files.find((f) => f.name === input.fileName);
      if (!file) throw new BackupFileRequestError("ไม่พบไฟล์นี้บน GDCC");
      if (file.protected) throw new BackupFileRequestError(`ไฟล์ล่าสุด ${view.keepMin} ไฟล์ต้องเก็บไว้เสมอ`);
      const reason = note(input.reason, true)!;
      const open = await store.listByStatus(OPEN_STATUSES);
      if (open.some((r) => r.fileName === file.name)) throw new BackupFileRequestError("มีคำขอสำหรับไฟล์นี้ที่ยังไม่ปิดอยู่แล้ว");
      const created = await store.create({
        fileName: file.name,
        sizeBytes: file.sizeBytes,
        reason,
        proposedById: actor.id,
        proposedByLabel: actor.username,
        proposedAt: clock(),
      });
      await record({ id: actor.id, label: actor.username }, "backup_file.destroy_proposed", created, correlationId, { sizeBytes: file.sizeBytes });
      return created;
    },

    async approve(actor: Actor, id: string, decisionNote: string, correlationId: string) {
      requirePermission(actor, "config.manage");
      const request = await load(id);
      if (request.proposedById === actor.id) throw new BackupFileRequestError("ผู้เสนออนุมัติคำขอของตัวเองไม่ได้");
      const now = clock();
      return move(actor, id, ["PROPOSED"], {
        status: "APPROVED",
        decidedById: actor.id,
        decidedByLabel: actor.username,
        decidedAt: now,
        decisionNote: note(decisionNote, false),
        holdUntil: new Date(now.getTime() + DELETION_HOLD_HOURS * 3_600_000),
      }, "backup_file.destroy_approved", correlationId);
    },

    async reject(actor: Actor, id: string, decisionNote: string, correlationId: string) {
      requirePermission(actor, "config.manage");
      return move(actor, id, ["PROPOSED"], {
        status: "REJECTED",
        decidedById: actor.id,
        decidedByLabel: actor.username,
        decidedAt: clock(),
        decisionNote: note(decisionNote, false),
      }, "backup_file.destroy_rejected", correlationId);
    },

    /** The proposer or any Security Administrator, until the hold ends and the instruction is sent. */
    async cancel(actor: Actor, id: string, decisionNote: string, correlationId: string) {
      requirePermission(actor, "backup.record");
      const request = await load(id);
      if (request.proposedById !== actor.id && !can(actor, "config.manage")) throw new ForbiddenError();
      return move(actor, id, ["PROPOSED", "APPROVED"], {
        status: "CANCELLED",
        completedAt: clock(),
        decisionNote: note(decisionNote, false) ?? request.decisionNote,
      }, "backup_file.destroy_cancelled", correlationId);
    },

    /** Worker: hands each approved request whose hold is over to the GDCC job. */
    async exportDue(write: (instruction: DestroyInstruction) => Promise<void>, correlationId: string) {
      const now = clock();
      const due = (await store.listByStatus(["APPROVED"])).filter((r) => r.holdUntil && r.holdUntil <= now);
      for (const request of due) {
        await write({ id: request.id, action: "destroy", file: request.fileName, size_bytes: request.sizeBytes, not_before: utc(request.holdUntil!) });
        if (await store.transition(request.id, ["APPROVED"], { status: "SENT", sentAt: now }))
          await record({ id: null, label: SYSTEM_ACTOR }, "backup_file.destroy_sent", request, correlationId);
      }
      return { sent: due.length };
    },

    /** Worker: records what the GDCC job did, from a fresh status only. */
    async reconcile(view: FilesView, correlationId: string) {
      if (view.state !== "fresh") return { completed: 0, closed: 0 };
      const now = clock();
      let completed = 0;
      let closed = 0;
      for (const request of await store.listByStatus(OPEN_STATUSES)) {
        const outcome: RequestOutcome | undefined = view.outcomes.get(request.id);
        if (request.status === "SENT" && outcome) {
          const status = outcome.outcome === "destroyed" ? "DESTROYED" : "FAILED";
          if (await store.transition(request.id, ["SENT"], { status, outcome: outcome.outcome, completedAt: outcome.at })) {
            await record({ id: null, label: SYSTEM_ACTOR }, status === "DESTROYED" ? "backup_file.destroyed" : "backup_file.destroy_failed", request, correlationId, { outcome: outcome.outcome });
            completed++;
          }
        } else if (request.status !== "SENT" && !view.files.some((f) => f.name === request.fileName)) {
          if (await store.transition(request.id, ["PROPOSED", "APPROVED"], { status: "CANCELLED", outcome: "file_gone", completedAt: now })) {
            await record({ id: null, label: SYSTEM_ACTOR }, "backup_file.destroy_cancelled", request, correlationId, { outcome: "file_gone" });
            closed++;
          }
        }
      }
      return { completed, closed };
    },
  };
}

export type BackupFileService = ReturnType<typeof createBackupFileService>;

/** Test and development store. */
export class InMemoryBackupFileRequestStore implements BackupFileRequestStore {
  readonly rows: BackupFileRequest[] = [];

  async create(request: NewBackupFileRequest) {
    const row: BackupFileRequest = {
      ...request,
      id: `bfr${this.rows.length + 1}`,
      status: "PROPOSED",
      decidedById: null,
      decidedByLabel: null,
      decidedAt: null,
      decisionNote: null,
      holdUntil: null,
      sentAt: null,
      completedAt: null,
      outcome: null,
    };
    this.rows.push(row);
    return { ...row };
  }
  async findById(id: string) {
    const row = this.rows.find((r) => r.id === id);
    return row ? { ...row } : null;
  }
  async list(limit: number) {
    return [...this.rows].sort((a, b) => b.proposedAt.getTime() - a.proposedAt.getTime()).slice(0, limit).map((r) => ({ ...r }));
  }
  async listByStatus(statuses: readonly RequestStatus[]) {
    return this.rows.filter((r) => statuses.includes(r.status)).map((r) => ({ ...r }));
  }
  async transition(id: string, from: readonly RequestStatus[], change: Partial<BackupFileRequest> & { status: RequestStatus }) {
    const row = this.rows.find((r) => r.id === id);
    if (!row || !from.includes(row.status)) return false;
    Object.assign(row, change);
    return true;
  }
}
