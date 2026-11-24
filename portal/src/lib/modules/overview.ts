import type { ModuleDefinition, ModuleId } from "./registry";

export type ModuleHealth = "ok" | "warn" | "bad" | "stale" | "waiting";

/** What a module reports for its overview tile (spec "Module contract"). */
export interface ModuleSummary {
  health: ModuleHealth;
  headline: string;
  detail: string;
  /** When the underlying data was last refreshed; null for live database counts. */
  asOf: Date | null;
}

export interface OverviewTile extends ModuleSummary {
  id: ModuleId;
  name: string;
  href: string;
}

/**
 * One tile per visible module. Missing data renders as "รอข้อมูล" and old data
 * as "ข้อมูลเก่า", never as zero or healthy.
 */
export function buildTiles(
  modules: readonly ModuleDefinition[],
  summaries: Partial<Record<ModuleId, ModuleSummary | null>>,
  now: Date,
): OverviewTile[] {
  return modules.map((m) => {
    const base = { id: m.id, name: m.name, href: m.href };
    const summary = summaries[m.id];
    if (!summary) return { ...base, health: "waiting", headline: "รอข้อมูล", detail: "", asOf: null };
    if (summary.asOf && now.getTime() - summary.asOf.getTime() > m.staleAfterMinutes * 60_000)
      return { ...base, ...summary, health: "stale", headline: "ข้อมูลเก่า" };
    return { ...base, ...summary };
  });
}
