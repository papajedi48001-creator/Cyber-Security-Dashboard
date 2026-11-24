import { describe, expect, it } from "vitest";
import { cloudBackupSummary, duoSummary, incidentsSummary, logSourcesSummary, portExposureSummary } from "./summaries";

describe("module summaries", () => {
  it("never shows missing Wazuh data as healthy", () => {
    const s = logSourcesSummary({
      connector: { status: "stale", reason: "ยังไม่เคยดึงข้อมูลจาก Wazuh สำเร็จ", lastError: null, lastSuccessAt: null },
      sources: [],
    });
    expect(s.health).toBe("waiting");
  });

  it("marks a stale Wazuh connector as stale with its last success time", () => {
    const at = new Date("2026-11-24T00:00:00Z");
    const s = logSourcesSummary({ connector: { status: "stale", reason: "เก่า", lastError: null, lastSuccessAt: at }, sources: [] });
    expect(s).toMatchObject({ health: "stale", asOf: at });
  });

  it("waits for a backup job and a port scan before claiming anything", () => {
    expect(cloudBackupSummary([]).health).toBe("waiting");
    const snap = { scan: { at: null, status: "missing", reason: "ยังไม่มีผลสแกน", scanner: null }, exposures: [] };
    expect(portExposureSummary(snap as never).health).toBe("waiting");
    expect(duoSummary({ state: "never_checked", last: null }).health).toBe("waiting");
  });

  it("raises incidents to bad when any P1 is open", () => {
    expect(incidentsSummary({ P1: 0, P2: 0, P3: 0, P4: 0 }, 0).health).toBe("ok");
    expect(incidentsSummary({ P1: 0, P2: 1, P3: 0, P4: 0 }, 0).health).toBe("warn");
    expect(incidentsSummary({ P1: 1, P2: 0, P3: 0, P4: 0 }, 0).health).toBe("bad");
  });
});
