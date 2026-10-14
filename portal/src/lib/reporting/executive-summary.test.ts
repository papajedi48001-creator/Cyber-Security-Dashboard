import { describe, expect, it } from "vitest";
import { buildExecutiveSummary, type ExecutiveInputs } from "./executive-summary";

const NOW = new Date("2026-10-14T03:00:00Z");

const inputs = (overrides: Partial<ExecutiveInputs> = {}): ExecutiveInputs => ({
  incidents: {
    periodStart: new Date("2026-09-30T17:00:00Z"),
    open: { P1: 1, P2: 0, P3: 2, P4: 0 },
    openedThisPeriod: { P1: 1, P2: 1, P3: 3, P4: 0 },
    closedThisPeriod: 2,
    acknowledgedOnTimeRate: 0.75,
    acknowledgementsBreached: 1,
    sources: { healthy: 1, stale: 1, unknown: 0 },
    notificationFailures: 0,
  },
  backups: { jobs: 2, ok: 2, needsAttention: 0, recoveryVerified: 1 },
  waf: { status: "fresh", total: 120, blocked: 100 },
  duo: { lastCheckedAt: NOW, overdue: false, issuesFound: false },
  ports: { scanStatus: "fresh", unapprovedExposures: 1, highRiskExposures: 1, restrictedEgressPorts: 0 },
  ...overrides,
});

describe("buildExecutiveSummary", () => {
  it("summarises in plain language and shows stale sources as gaps", () => {
    const summary = buildExecutiveSummary(inputs(), NOW);
    expect(summary.incidents.acknowledgedOnTimePercent).toBe(75);
    expect(summary.web.sampled).toBe(true);
    expect(summary.duo.manual).toBe(true);
    expect(summary.attention).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ระดับวิกฤตหรือสูงที่ยังไม่ปิด 1"),
        expect.stringContaining("แหล่ง Log ขาดหายหรือไม่ทราบสถานะ 1"),
        expect.stringContaining("ยังไม่ยืนยันว่ากู้คืนได้ 1"),
        expect.stringContaining("โดยไม่ได้รับอนุมัติ 1"),
      ]),
    );
  });

  it("treats unknown data as needing attention, not as all clear", () => {
    const summary = buildExecutiveSummary(
      inputs({
        waf: { status: "unavailable", total: null, blocked: null },
        ports: { scanStatus: "missing", unapprovedExposures: 0, highRiskExposures: 0, restrictedEgressPorts: 0 },
        duo: { lastCheckedAt: null, overdue: true, issuesFound: null },
      }),
      NOW,
    );
    expect(summary.web.events).toBeNull();
    expect(summary.attention).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Cloudflare WAF"),
        expect.stringContaining("ผลสแกนพอร์ต"),
        expect.stringContaining("Duo"),
      ]),
    );
  });

  it("contains no addresses, usernames, titles, paths or vulnerability detail", () => {
    const text = JSON.stringify(buildExecutiveSummary(inputs(), NOW));
    expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(text).not.toMatch(/username|checkedBy|title|path|description|cve|ruleId|sourceName|address|owner/i);
  });
});
