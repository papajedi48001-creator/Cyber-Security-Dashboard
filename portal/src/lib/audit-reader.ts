// Read side of the audit trail for System Settings › บันทึกการใช้งาน. It only
// lists; records are append-only and the database rejects UPDATE and DELETE.

import type { AuditRecord } from "./audit";
import { requirePermission, type Principal } from "./auth/authorize";

export interface AuditCursor {
  at: Date;
  id: string;
}

export interface AuditQuery {
  limit: number;
  before?: AuditCursor;
  actionPrefix?: string;
}

export interface AuditQueryStore {
  /** Newest first: ordered by `at` then `id`, both descending. */
  query(query: AuditQuery): Promise<AuditRecord[]>;
}

export interface AuditPage {
  records: AuditRecord[];
  nextBefore: string | null;
}

const MAX_LIMIT = 200;

export function encodeCursor(record: Pick<AuditRecord, "at" | "id">): string {
  return `${record.at.toISOString()}|${record.id}`;
}

export function decodeCursor(value: string | undefined): AuditCursor | undefined {
  if (!value) return undefined;
  const [iso, id] = value.split("|");
  const at = new Date(iso ?? "");
  if (!id || Number.isNaN(at.getTime())) return undefined;
  return { at, id };
}

export function createAuditReader(store: AuditQueryStore) {
  return {
    async list(actor: Principal, input: { limit: number; before?: string; actionPrefix?: string }): Promise<AuditPage> {
      requirePermission(actor, "audit.read");
      const limit = Math.min(Math.max(1, Math.floor(input.limit)), MAX_LIMIT);
      const prefix = input.actionPrefix?.trim() || undefined;
      const rows = await store.query({ limit: limit + 1, before: decodeCursor(input.before), actionPrefix: prefix });
      const records = rows.slice(0, limit);
      return { records, nextBefore: rows.length > limit ? encodeCursor(records[records.length - 1]!) : null };
    },
  };
}

export type AuditReader = ReturnType<typeof createAuditReader>;

export function compareNewestFirst(a: Pick<AuditRecord, "at" | "id">, b: Pick<AuditRecord, "at" | "id">): number {
  return b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}
