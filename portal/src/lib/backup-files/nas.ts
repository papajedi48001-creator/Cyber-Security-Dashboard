// NAS retention status for the HOSxP backup ZIPs (ADR 0011). The prune task on
// the hospital NAS keeps the newest complete sets and writes this status; the
// HOSxP server uploads it with each run and it reaches the Portal through the
// GDCC status exchange. Read-only: the Portal has no control over the NAS.

import { z } from "zod";

/** The NAS task runs daily; a report older than this is stale. */
export const NAS_STALE_HOURS = 26;

const UTC_STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const DATE = /^\d{4}-\d\d-\d\d$/;
const fileName = z.string().max(160).regex(/^[A-Za-z0-9._-]+$/);
const bytes = z.number().int().nonnegative();

const schema = z.object({
  schema: z.literal(1),
  generated_at: z.string().regex(UTC_STAMP).transform((s) => new Date(s)),
  keep_count: z.number().int().positive(),
  complete_sets: z.number().int().nonnegative(),
  newest_set_date: z.string().regex(DATE).nullable(),
  oldest_set_date: z.string().regex(DATE).nullable(),
  sets: z.array(z.object({ date: z.string().regex(DATE), zip_name: fileName, zip_bytes: bytes })).max(400),
  deleted_files: z.array(fileName).max(400),
  free_bytes: bytes,
  total_bytes: bytes.positive(),
  last_run_ok: z.boolean(),
  error: z.string().max(300).nullable(),
});

export type NasStatus = z.infer<typeof schema>;

export function parseNasStatus(text: string): NasStatus | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface NasView {
  state: "fresh" | "stale" | "failed" | "unavailable";
  generatedAt: Date | null;
  keepCount: number;
  completeSets: number;
  belowKeep: boolean;
  sets: { date: string; zipName: string; zipBytes: number }[];
  days: { date: string; state: "present" | "missing" }[];
  deletedFiles: string[];
  volume: { totalBytes: number; freeBytes: number; usedPercent: number } | null;
  error: string | null;
}

export function evaluateNasStatus(status: NasStatus | null, now: Date): NasView {
  if (!status) {
    return { state: "unavailable", generatedAt: null, keepCount: 0, completeSets: 0, belowKeep: false, sets: [], days: [], deletedFiles: [], volume: null, error: null };
  }
  const stale = now.getTime() - status.generated_at.getTime() > NAS_STALE_HOURS * 3_600_000;
  const sets = [...status.sets].sort((a, b) => b.date.localeCompare(a.date)).map((s) => ({ date: s.date, zipName: s.zip_name, zipBytes: s.zip_bytes }));
  const present = new Set(sets.map((s) => s.date));
  const days: NasView["days"] = [];
  if (sets.length) {
    const oldest = sets[sets.length - 1]!.date;
    for (let d = new Date(`${sets[0]!.date}T00:00:00Z`); days.length < 60; d = new Date(d.getTime() - 86_400_000)) {
      const date = d.toISOString().slice(0, 10);
      if (date < oldest) break;
      days.push({ date, state: present.has(date) ? "present" : "missing" });
    }
  }
  return {
    state: stale ? "stale" : status.last_run_ok ? "fresh" : "failed",
    generatedAt: status.generated_at,
    keepCount: status.keep_count,
    completeSets: status.complete_sets,
    belowKeep: status.complete_sets < status.keep_count,
    sets,
    days,
    deletedFiles: status.deleted_files,
    volume: {
      totalBytes: status.total_bytes,
      freeBytes: status.free_bytes,
      usedPercent: Math.round((1000 * (status.total_bytes - status.free_bytes)) / status.total_bytes) / 10,
    },
    error: status.error,
  };
}
