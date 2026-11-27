// Backup File Management (ADR 0011): the status the GDCC store job writes for
// the HOSxP daily backup files. It lists file names, sizes and checksum state
// only, never anything from inside a backup. Missing or old status renders as
// unavailable or stale, never as an empty, healthy store.

import { z } from "zod";

/** The store job runs every 10 minutes and sync every 5; older than this is stale. */
export const STATUS_STALE_MINUTES = 30;
/** GDCC grants more storage once a VM uses more than this (ADR 0010). */
export const EXPAND_AT_PERCENT = 75;
/** A file smaller than this share of the median of the others is flagged. */
const SMALL_RATIO = 0.5;
const MAX_DAYS = 14;

const BACKUP_NAME = /^MySQL_backup_[A-Za-z0-9._-]+\.zip$/i;
const UTC_STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const stamp = z.string().regex(UTC_STAMP).transform((s) => new Date(s));
const bytes = z.number().int().nonnegative();
const backupName = z.string().max(128).regex(BACKUP_NAME);

const schema = z.object({
  schema: z.literal(1),
  generated_at: stamp,
  volume: z.object({ total_bytes: bytes.positive(), used_bytes: bytes, free_bytes: bytes }),
  max_use_percent: z.number().positive().max(100),
  keep_min: z.number().int().nonnegative(),
  files: z.array(z.object({ name: backupName, size_bytes: bytes, modified_at: stamp, checksum: z.enum(["verified", "missing"]) })).max(1000),
  inbox_pending: z.number().int().nonnegative(),
  pruned: z.array(z.object({ file: backupName, at: stamp })).max(500),
  corrupt: z.array(z.object({ file: backupName, at: stamp })).max(500),
  requests: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        file: backupName.nullable(),
        outcome: z.enum(["destroyed", "protected", "size_mismatch", "not_found", "rejected"]),
        at: stamp,
      }),
    )
    .max(500),
});

export type RequestOutcome = z.infer<typeof schema>["requests"][number];

export interface FilesStatus {
  generatedAt: Date;
  volume: { totalBytes: number; usedBytes: number; freeBytes: number };
  maxUsePercent: number;
  keepMin: number;
  files: { name: string; sizeBytes: number; modifiedAt: Date; checksum: "verified" | "missing" }[];
  inboxPending: number;
  pruned: { file: string; at: Date }[];
  corrupt: { file: string; at: Date }[];
  requests: RequestOutcome[];
}

export function parseFilesStatus(text: string): FilesStatus | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  const s = parsed.data;
  return {
    generatedAt: s.generated_at,
    volume: { totalBytes: s.volume.total_bytes, usedBytes: s.volume.used_bytes, freeBytes: s.volume.free_bytes },
    maxUsePercent: s.max_use_percent,
    keepMin: s.keep_min,
    files: s.files.map((f) => ({ name: f.name, sizeBytes: f.size_bytes, modifiedAt: f.modified_at, checksum: f.checksum })),
    inboxPending: s.inbox_pending,
    pruned: s.pruned,
    corrupt: s.corrupt,
    requests: s.requests,
  };
}

export type FilesState = "fresh" | "stale" | "unavailable";
export type VolumeLevel = "ok" | "expand" | "pruning";

export interface BackupFileView {
  name: string;
  sizeBytes: number;
  modifiedAt: Date;
  checksum: "verified" | "missing";
  /** YYYY-MM-DD in Bangkok: from the name's timestamp, else from when the file arrived. */
  backupDate: string;
  /** One of the newest files the GDCC job always keeps; it cannot be requested for destruction. */
  protected: boolean;
  small: boolean;
}

export interface FilesView {
  state: FilesState;
  generatedAt: Date | null;
  volume: (FilesStatus["volume"] & { usedPercent: number; level: VolumeLevel; maxUsePercent: number }) | null;
  keepMin: number;
  files: BackupFileView[];
  days: { date: string; state: "present" | "missing" | "pending" }[];
  inboxPending: number;
  pruned: FilesStatus["pruned"];
  corrupt: FilesStatus["corrupt"];
  outcomes: Map<string, RequestOutcome>;
}

const bangkokDate = (date: Date) => new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

function backupDate(name: string, modifiedAt: Date): string {
  const m = /_(\d{4})(\d\d)(\d\d)\d{6}\.zip$/i.exec(name);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : bangkokDate(modifiedAt);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

export function evaluateFilesStatus(status: FilesStatus | null, now: Date): FilesView {
  if (!status) {
    return { state: "unavailable", generatedAt: null, volume: null, keepMin: 0, files: [], days: [], inboxPending: 0, pruned: [], corrupt: [], outcomes: new Map() };
  }
  const state: FilesState = now.getTime() - status.generatedAt.getTime() > STATUS_STALE_MINUTES * 60_000 ? "stale" : "fresh";
  const usedPercent = Math.round((1000 * status.volume.usedBytes) / status.volume.totalBytes) / 10;
  const level: VolumeLevel = usedPercent > status.maxUsePercent ? "pruning" : usedPercent > EXPAND_AT_PERCENT ? "expand" : "ok";

  const ordered = [...status.files].sort((a, b) => b.name.localeCompare(a.name));
  const files = ordered.map((f, index) => {
    const others = median(ordered.filter((o) => o !== f).map((o) => o.sizeBytes));
    return {
      ...f,
      backupDate: backupDate(f.name, f.modifiedAt),
      protected: index < status.keepMin,
      small: others !== null && f.sizeBytes < others * SMALL_RATIO,
    };
  });

  const present = new Set(files.map((f) => f.backupDate));
  const today = bangkokDate(now);
  const oldest = files.at(-1)?.backupDate ?? today;
  const days: FilesView["days"] = [];
  for (let d = new Date(`${today}T00:00:00Z`); days.length < MAX_DAYS; d = new Date(d.getTime() - 86_400_000)) {
    const date = d.toISOString().slice(0, 10);
    if (date < oldest) break;
    days.push({ date, state: present.has(date) ? "present" : date === today ? "pending" : "missing" });
  }

  return {
    state,
    generatedAt: status.generatedAt,
    volume: { ...status.volume, usedPercent, level, maxUsePercent: status.maxUsePercent },
    keepMin: status.keepMin,
    files,
    days,
    inboxPending: status.inboxPending,
    pruned: [...status.pruned].reverse(),
    corrupt: [...status.corrupt].reverse(),
    outcomes: new Map(status.requests.map((r) => [r.id, r])),
  };
}
