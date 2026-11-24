import { describe, expect, it } from "vitest";
import { buildTiles } from "./overview";
import { MODULES, visibleModules } from "./registry";

const NOW = new Date("2026-11-24T05:00:00Z");
const only = <T,>(xs: T[]): T => {
  expect(xs).toHaveLength(1);
  return xs[0]!;
};
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("overview tiles", () => {
  it("gives every visible module exactly one tile, in registry order", () => {
    const visible = visibleModules("SECURITY_OPERATOR", {});
    const tiles = buildTiles(visible, {}, NOW);
    expect(tiles.map((t) => t.id)).toEqual(visible.map((m) => m.id));
  });

  it("renders a module with no summary as waiting, never as healthy", () => {
    const tile = only(buildTiles([MODULES.find((m) => m.id === "cloud-backup")!], {}, NOW));
    expect(tile.health).toBe("waiting");
    expect(tile.headline).toBe("รอข้อมูล");
  });

  it("renders a summary older than the module's stale threshold as stale", () => {
    const sources = MODULES.find((m) => m.id === "log-sources")!;
    const fresh = { health: "ok" as const, headline: "ปกติ", detail: "", asOf: minutesAgo(1) };
    const old = { ...fresh, asOf: minutesAgo(sources.staleAfterMinutes + 1) };
    expect(only(buildTiles([sources], { "log-sources": fresh }, NOW)).health).toBe("ok");
    const stale = only(buildTiles([sources], { "log-sources": old }, NOW));
    expect(stale.health).toBe("stale");
    expect(stale.headline).toBe("ข้อมูลเก่า");
    expect(stale.asOf).toEqual(old.asOf);
  });

  it("keeps a summary's own stale or bad verdict", () => {
    const ports = MODULES.find((m) => m.id === "port-exposure")!;
    const bad = { health: "bad" as const, headline: "เปิดโดยไม่ได้รับอนุมัติ 2 รายการ", detail: "", asOf: minutesAgo(1) };
    expect(only(buildTiles([ports], { "port-exposure": bad }, NOW))).toMatchObject({ health: "bad", headline: bad.headline });
  });

  it("does not age out a summary that has no timestamp", () => {
    const incidents = MODULES.find((m) => m.id === "incidents")!;
    const live = { health: "ok" as const, headline: "ไม่มี incident ที่ยังไม่ปิด", detail: "", asOf: null };
    expect(only(buildTiles([incidents], { incidents: live }, NOW)).health).toBe("ok");
  });
});
