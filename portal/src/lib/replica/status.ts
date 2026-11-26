// Portal MariaDB replica on GDCC (ADR 0009). The replica protects Portal
// records; it is not high availability. Unknown, unreachable or old checks are
// never shown as healthy.

export type ReplicaState = "healthy" | "lagging" | "broken" | "unavailable";
export type ReplicaViewState = ReplicaState | "stale" | "not_configured";

export const MAX_HEALTHY_LAG_SECONDS = 300;
export const REPLICA_CHECK_STALE_MINUTES = 15;
const ERROR_LIMIT = 200;

export interface ReplicaObservation {
  state: ReplicaState;
  lagSeconds: number | null;
  ioRunning: boolean;
  sqlRunning: boolean;
  error: string | null;
}

export interface ReplicaCheck extends ReplicaObservation {
  consecutiveFailures: number;
  checkedAt: Date;
}

const field = (row: Record<string, unknown>, name: string) => row[`Slave_${name}`] ?? row[`Replica_${name}`];

function shorten(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, ERROR_LIMIT);
}

/** Error text safe to store and show: no connection URLs or credentials. */
export function sanitizeReplicaError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return shorten(raw.replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, "<url>").replace(/\S+:\S+@\S+/g, "<credentials>")) || "ไม่ทราบสาเหตุ";
}

/** Evaluates one row of SHOW REPLICA STATUS; null means the server is not a replica. */
export function evaluateReplicaStatus(row: Record<string, unknown> | null): ReplicaObservation {
  if (!row) return { state: "unavailable", lagSeconds: null, ioRunning: false, sqlRunning: false, error: "เซิร์ฟเวอร์นี้ไม่ได้ตั้งค่าเป็น replica" };
  const ioRunning = field(row, "IO_Running") === "Yes";
  const sqlRunning = field(row, "SQL_Running") === "Yes";
  const lagRaw = row.Seconds_Behind_Master ?? row.Seconds_Behind_Primary;
  const lagSeconds = typeof lagRaw === "bigint" || typeof lagRaw === "number" ? Number(lagRaw) : null;
  const errorText = [row.Last_IO_Error, row.Last_SQL_Error].filter((e) => typeof e === "string" && e.trim()).join("; ");
  const error = errorText ? shorten(errorText) : null;
  if (!ioRunning || !sqlRunning)
    return { state: "broken", lagSeconds, ioRunning, sqlRunning, error: error ?? "replication thread หยุดทำงาน" };
  if (lagSeconds === null || lagSeconds > MAX_HEALTHY_LAG_SECONDS) return { state: "lagging", lagSeconds, ioRunning, sqlRunning, error };
  return { state: "healthy", lagSeconds, ioRunning, sqlRunning, error };
}

export function replicaView(check: ReplicaCheck | null, configured: boolean, now: Date) {
  if (!configured) return { state: "not_configured" as ReplicaViewState, check, reason: "ยังไม่ได้ตั้งค่าการตรวจ replica" };
  if (!check || now.getTime() - check.checkedAt.getTime() > REPLICA_CHECK_STALE_MINUTES * 60_000)
    return { state: "stale" as ReplicaViewState, check, reason: `ไม่มีผลตรวจ replica ภายใน ${REPLICA_CHECK_STALE_MINUTES} นาที (worker อาจหยุดทำงาน)` };
  return { state: check.state as ReplicaViewState, check, reason: check.error ?? "" };
}
