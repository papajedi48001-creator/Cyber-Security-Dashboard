import { describe, expect, it } from "vitest";
import { evaluateReplicaStatus, replicaView, sanitizeReplicaError, selectReplicaRow, type ReplicaCheck } from "./status";

const running = { Slave_IO_Running: "Yes", Slave_SQL_Running: "Yes", Seconds_Behind_Master: 10n, Last_IO_Error: "", Last_SQL_Error: "" };

describe("evaluateReplicaStatus", () => {
  it("is healthy when both threads run and lag is within 300 seconds", () => {
    expect(evaluateReplicaStatus(running)).toEqual({ state: "healthy", lagSeconds: 10, ioRunning: true, sqlRunning: true, error: null });
    expect(evaluateReplicaStatus({ ...running, Seconds_Behind_Master: 300 }).state).toBe("healthy");
  });

  it("is lagging above 300 seconds or when lag is unknown", () => {
    expect(evaluateReplicaStatus({ ...running, Seconds_Behind_Master: 301 }).state).toBe("lagging");
    expect(evaluateReplicaStatus({ ...running, Seconds_Behind_Master: null })).toMatchObject({ state: "lagging", lagSeconds: null });
  });

  it("is broken when a thread is stopped or connecting, with the replication error", () => {
    expect(evaluateReplicaStatus({ ...running, Slave_IO_Running: "Connecting", Last_IO_Error: "error connecting to master" })).toMatchObject({
      state: "broken",
      ioRunning: false,
      error: "error connecting to master",
    });
    expect(evaluateReplicaStatus({ ...running, Slave_SQL_Running: "No", Last_SQL_Error: "Duplicate entry" })).toMatchObject({
      state: "broken",
      error: "Duplicate entry",
    });
  });

  it("reads the Replica_* column names too", () => {
    expect(evaluateReplicaStatus({ Replica_IO_Running: "Yes", Replica_SQL_Running: "Yes", Seconds_Behind_Master: 0 }).state).toBe("healthy");
  });

  it("is unavailable when the server is not a replica", () => {
    expect(evaluateReplicaStatus(null)).toMatchObject({ state: "unavailable", error: "เซิร์ฟเวอร์นี้ไม่ได้ตั้งค่าเป็น replica" });
  });
});

describe("sanitizeReplicaError", () => {
  it("removes connection URLs and credentials and shortens the text", () => {
    const text = sanitizeReplicaError(new Error("failed mysql://portal-monitor:hunter2@198.51.100.40:3306/ " + "x".repeat(500)));
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("mysql://");
    expect(text.length).toBeLessThanOrEqual(200);
  });
});

describe("replicaView", () => {
  const now = new Date("2026-11-26T10:00:00Z");
  const check: ReplicaCheck = { state: "healthy", lagSeconds: 1, ioRunning: true, sqlRunning: true, error: null, consecutiveFailures: 0, checkedAt: now };

  it("says not configured instead of healthy when monitoring is off", () => {
    expect(replicaView(null, false, now).state).toBe("not_configured");
  });

  it("is stale when the worker has not checked for more than 15 minutes", () => {
    expect(replicaView(check, true, new Date(now.getTime() + 15 * 60_000)).state).toBe("healthy");
    expect(replicaView(check, true, new Date(now.getTime() + 15 * 60_000 + 1)).state).toBe("stale");
    expect(replicaView(null, true, now).state).toBe("stale");
  });
});

describe("selectReplicaRow", () => {
  const portal = { Connection_name: "portal", Slave_IO_Running: "Yes" };
  const hosxp = { Connection_name: "hosxp", Slave_IO_Running: "No" };
  const unnamed = { Connection_name: "", Slave_IO_Running: "Yes" };

  it("picks the named multi-source connection from SHOW ALL REPLICAS STATUS", () => {
    expect(selectReplicaRow([portal, hosxp], "hosxp")).toBe(hosxp);
    expect(selectReplicaRow([portal, hosxp], "portal")).toBe(portal);
  });

  it("picks the unnamed default connection with an empty name", () => {
    expect(selectReplicaRow([unnamed], "")).toBe(unnamed);
  });

  it("returns null when the connection does not exist, so it is never shown as healthy", () => {
    expect(selectReplicaRow([portal], "hosxp")).toBeNull();
    expect(selectReplicaRow([], "")).toBeNull();
    expect(evaluateReplicaStatus(selectReplicaRow([portal], "hosxp")).state).toBe("unavailable");
  });
});
