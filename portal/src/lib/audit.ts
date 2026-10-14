// Append-only audit trail for every Portal mutation, connector action and
// configuration change. The database also rejects UPDATE/DELETE (migration trigger).

export interface AuditInput {
  actor: { id: string | null; label: string };
  action: string;
  target: { type: string; id?: string | null };
  metadata?: Record<string, unknown>;
  correlationId: string;
}

export interface AuditRecord {
  id: string;
  at: Date;
  actorId: string | null;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  correlationId: string;
}

export type NewAuditRecord = Omit<AuditRecord, "id">;

export interface AuditStore {
  append(record: NewAuditRecord): Promise<AuditRecord>;
}

export interface AuditLog {
  append(input: AuditInput): Promise<AuditRecord>;
}

export class UnsafeAuditDataError extends Error {
  constructor(path: string, reason: string) {
    super(`Audit metadata rejected at "${path}": ${reason}`);
    this.name = "UnsafeAuditDataError";
  }
}

const FORBIDDEN_KEY_TOKENS = new Set([
  "password", "passwd", "pwd", "secret", "totp", "otp", "token", "cookie", "credential", "credentials",
  "raw", "payload", "fulllog", "patient", "hn", "cid", "nationalid", "diagnosis", "ssn", "key",
]);
const THAI_NATIONAL_ID = /(?<!\d)\d{13}(?!\d)/;
const MAX_VALUE_LENGTH = 2000;
const MAX_DEPTH = 3;
const ACTION_PATTERN = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

function keyTokens(key: string): string[] {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return [...words, words.join("")];
}

function checkValue(value: unknown, path: string, depth: number): void {
  if (value === null || typeof value === "number" || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > MAX_VALUE_LENGTH) throw new UnsafeAuditDataError(path, "value too long");
    if (THAI_NATIONAL_ID.test(value)) throw new UnsafeAuditDataError(path, "looks like a national ID");
    return;
  }
  if (depth >= MAX_DEPTH) throw new UnsafeAuditDataError(path, "nested too deeply");
  if (Array.isArray(value)) {
    value.forEach((item, i) => checkValue(item, `${path}[${i}]`, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (keyTokens(key).some((token) => FORBIDDEN_KEY_TOKENS.has(token)))
        throw new UnsafeAuditDataError(childPath, "field name is not allowed in audit data");
      checkValue(child, childPath, depth + 1);
    }
    return;
  }
  throw new UnsafeAuditDataError(path, `unsupported type ${typeof value}`);
}

export function assertSafeAuditMetadata(metadata: Record<string, unknown> | undefined): void {
  if (metadata !== undefined) checkValue(metadata, "", 0);
}

export function createAuditLog(store: AuditStore, clock: () => Date = () => new Date()): AuditLog {
  return {
    async append(input) {
      if (!ACTION_PATTERN.test(input.action)) throw new Error(`invalid audit action name: ${input.action}`);
      if (!input.correlationId) throw new Error("audit correlation id is required");
      if (!input.actor.label) throw new Error("audit actor label is required");
      assertSafeAuditMetadata(input.metadata);
      const record = await store.append({
        at: clock(),
        actorId: input.actor.id,
        actorLabel: input.actor.label,
        action: input.action,
        targetType: input.target.type,
        targetId: input.target.id ?? null,
        metadata: input.metadata ?? null,
        correlationId: input.correlationId,
      });
      return Object.freeze(record);
    },
  };
}

/** Test and development store. */
export class InMemoryAuditStore implements AuditStore {
  readonly records: AuditRecord[] = [];

  async append(record: NewAuditRecord): Promise<AuditRecord> {
    const stored = Object.freeze({ ...record, id: `audit-${this.records.length + 1}` });
    this.records.push(stored);
    return stored;
  }
}
