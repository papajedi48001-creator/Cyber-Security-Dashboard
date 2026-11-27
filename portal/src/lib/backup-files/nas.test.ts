import { describe, expect, it } from "vitest";
import { evaluateNasStatus, NAS_STALE_HOURS, parseNasStatus } from "./nas";

const GIB = 1024 ** 3;
const now = new Date("2026-11-27T04:00:00Z"); // 11:00 Bangkok
// Synthetic names: real ones carry the HOSxP server's address, so tests use 192.0.2.10.
const zip = (date: string) => `MySQL_backup_192.0.2.10_11093_${date.replaceAll("-", "")}000103.ZIP`;

function status(overrides: Record<string, unknown> = {}) {
  const dates = ["2026-11-27", "2026-11-26", "2026-11-24"];
  return {
    schema: 1,
    generated_at: "2026-11-26T22:10:00Z",
    keep_count: 15,
    complete_sets: 3,
    newest_set_date: "2026-11-27",
    oldest_set_date: "2026-11-24",
    sets: dates.map((date) => ({ date, zip_name: zip(date), zip_bytes: 36 * GIB })),
    deleted_files: [zip("2026-11-09")],
    free_bytes: 2600 * GIB,
    total_bytes: 20000 * GIB,
    last_run_ok: true,
    error: null,
    ...overrides,
  };
}
const view = (overrides: Record<string, unknown> = {}, at = now) => evaluateNasStatus(parseNasStatus(JSON.stringify(status(overrides))), at);

describe("NAS retention status", () => {
  it("rejects anything but the agreed format", () => {
    expect(parseNasStatus("nope")).toBeNull();
    expect(parseNasStatus(JSON.stringify(status({ schema: 2 })))).toBeNull();
    expect(parseNasStatus(JSON.stringify(status({ sets: [{ date: "27/11", zip_name: "x", zip_bytes: 1 }] })))).toBeNull();
  });

  it("shows unavailable, not healthy, without a status", () => {
    expect(evaluateNasStatus(null, now)).toMatchObject({ state: "unavailable", sets: [], volume: null });
  });

  it("reads a recent run as fresh, with volume use and the files it deleted", () => {
    const v = view();
    expect(v.state).toBe("fresh");
    expect(v.volume).toMatchObject({ usedPercent: 87 });
    expect(v.deletedFiles).toEqual([zip("2026-11-09")]);
    expect(v.sets[0]).toMatchObject({ date: "2026-11-27", zipBytes: 36 * GIB });
  });

  it("is stale after a day without a report", () => {
    expect(view({}, new Date(Date.parse("2026-11-26T22:10:00Z") + (NAS_STALE_HOURS + 1) * 3_600_000)).state).toBe("stale");
  });

  it("reports a failed run with its reason", () => {
    expect(view({ last_run_ok: false, error: "share not mounted" })).toMatchObject({ state: "failed", error: "share not mounted" });
  });

  it("flags fewer complete sets than it should keep, and days missing between them", () => {
    const v = view();
    expect(v.belowKeep).toBe(true);
    expect(v.days.filter((d) => d.state === "missing").map((d) => d.date)).toEqual(["2026-11-25"]);
    expect(view({ complete_sets: 15 }).belowKeep).toBe(false);
  });
});
