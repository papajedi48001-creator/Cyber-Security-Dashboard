import { describe, expect, it } from "vitest";
import {
  backupTile,
  duoTile,
  incidentTile,
  logSourceTile,
  portTile,
  replicaTile,
  wafTile,
} from "./summary";

describe("overview tiles", () => {
  it("incidents: bad with an open P1 or a breached SLA, ok when nothing is open", () => {
    expect(incidentTile({ open: { P1: 1, P2: 0, P3: 0, P4: 0 }, attention: 0 }).health).toBe("bad");
    expect(incidentTile({ open: { P1: 0, P2: 0, P3: 2, P4: 0 }, attention: 1 }).health).toBe("warn");
    const quiet = incidentTile({ open: { P1: 0, P2: 0, P3: 0, P4: 0 }, attention: 0 });
    expect(quiet.health).toBe("ok");
    expect(quiet.headline).toBe("ไม่มี incident เปิดอยู่");
  });

  it("log sources: stale when the connector is stale, never healthy", () => {
    const tile = logSourceTile({ connector: { status: "stale", reason: "ยังไม่เคยดึงข้อมูลจาก Wazuh สำเร็จ" }, total: 0, unhealthy: 0 });
    expect(tile.health).toBe("stale");
    expect(tile.headline).toBe("ข้อมูลเก่า");
  });

  it("log sources: waiting when no source is registered", () => {
    expect(logSourceTile({ connector: { status: "fresh", reason: "" }, total: 0, unhealthy: 0 }).health).toBe("waiting");
  });

  it("backups: waiting with no tracked job, bad with a failing job", () => {
    expect(backupTile({ jobs: 0, problems: 0, unverified: 0 }).health).toBe("waiting");
    expect(backupTile({ jobs: 0, problems: 0, unverified: 0 }).headline).toBe("รอข้อมูล");
    expect(backupTile({ jobs: 3, problems: 1, unverified: 0 }).health).toBe("bad");
    expect(backupTile({ jobs: 3, problems: 0, unverified: 2 }).health).toBe("warn");
  });

  it("ports: waiting without a scan, stale with an old scan", () => {
    expect(portTile({ scan: { status: "missing", reason: "x", at: null }, unapproved: 0 }).health).toBe("waiting");
    expect(portTile({ scan: { status: "stale", reason: "x", at: new Date() }, unapproved: 0 }).health).toBe("stale");
    expect(portTile({ scan: { status: "fresh", reason: "x", at: new Date() }, unapproved: 2 }).health).toBe("bad");
  });

  it("WAF: waiting when not configured", () => {
    expect(wafTile({ status: "unavailable", reason: "ยังไม่ได้ตั้งค่า", fetchedAt: null, total: null }).health).toBe("waiting");
    expect(wafTile({ status: "stale", reason: "เก่า", fetchedAt: new Date(), total: 5 }).health).toBe("stale");
  });

  it("Duo: waiting before the first check, bad when overdue", () => {
    expect(duoTile({ state: "never_checked", lastAt: null }).health).toBe("waiting");
    expect(duoTile({ state: "overdue", lastAt: new Date() }).health).toBe("bad");
  });

  it("replica: waiting until a report arrives, never 0% or healthy", () => {
    const tile = replicaTile();
    expect(tile.health).toBe("waiting");
    expect(tile.headline).not.toMatch(/0\s*%/);
  });
});
