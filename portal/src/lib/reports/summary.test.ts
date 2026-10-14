import { describe, expect, it } from "vitest";
import { bangkokMonthStart, summarize, type IncidentFacts } from "./summary";

const NOW = new Date("2026-10-14T03:00:00Z");
const at = (iso: string) => new Date(iso);

const incident = (overrides: Partial<IncidentFacts>): IncidentFacts => ({
  severity: "P2",
  status: "NEW",
  detectedAt: at("2026-10-10T00:00:00Z"),
  acknowledgeDue: at("2026-10-10T01:00:00Z"),
  acknowledgedAt: null,
  closedAt: null,
  ...overrides,
});

describe("bangkokMonthStart", () => {
  it("uses the Bangkok calendar month", () => {
    expect(bangkokMonthStart(NOW)).toEqual(at("2026-09-30T17:00:00Z"));
    expect(bangkokMonthStart(at("2026-09-30T18:00:00Z"))).toEqual(at("2026-09-30T17:00:00Z"));
  });
});

describe("summarize", () => {
  it("counts open, opened and closed incidents and the acknowledgement rate", () => {
    const summary = summarize(
      [
        incident({ severity: "P1", acknowledgedAt: at("2026-10-10T00:10:00Z"), acknowledgeDue: at("2026-10-10T00:15:00Z") }),
        incident({ severity: "P2" }), // never acknowledged, overdue
        incident({ severity: "P3", status: "CLOSED", acknowledgedAt: at("2026-10-10T00:30:00Z"), closedAt: at("2026-10-11T00:00:00Z") }),
        incident({ severity: "P4", status: "CLOSED", detectedAt: at("2026-09-01T00:00:00Z"), acknowledgeDue: at("2026-09-01T09:00:00Z"), closedAt: at("2026-09-02T00:00:00Z") }),
      ],
      [{ status: "healthy" }, { status: "stale" }],
      1,
      NOW,
    );
    expect(summary.open).toEqual({ P1: 1, P2: 1, P3: 0, P4: 0 });
    expect(summary.openedThisPeriod).toEqual({ P1: 1, P2: 1, P3: 1, P4: 0 });
    expect(summary.closedThisPeriod).toBe(1);
    expect(summary.acknowledgedOnTimeRate).toBeCloseTo(2 / 3);
    expect(summary.acknowledgementsBreached).toBe(1);
    expect(summary.sources).toEqual({ healthy: 1, stale: 1, unknown: 0 });
    expect(summary.notificationFailures).toBe(1);
  });

  it("reports no rate rather than 100% when nothing was due", () => {
    expect(summarize([], [], 0, NOW).acknowledgedOnTimeRate).toBeNull();
  });

  it("carries counts only", () => {
    const keys = JSON.stringify(summarize([incident({})], [{ status: "healthy" }], 0, NOW));
    expect(keys).not.toMatch(/title|sourceName|number|owner/);
  });
});
