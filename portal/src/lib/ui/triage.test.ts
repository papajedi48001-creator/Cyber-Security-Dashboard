import { describe, expect, it } from "vitest";
import {
  backupsTriage,
  duoTriage,
  incidentsTriage,
  notificationsTriage,
  portsTriage,
  sourcesTriage,
  wafTriage,
} from "./triage";

const noOpen = { P1: 0, P2: 0, P3: 0, P4: 0 };

describe("incidentsTriage", () => {
  it("asks for action when an SLA is due soon or breached", () => {
    expect(incidentsTriage({ open: { ...noOpen, P3: 1 }, attention: 1 }).level).toBe("act");
  });
  it("asks for action while any P1 is open", () => {
    expect(incidentsTriage({ open: { ...noOpen, P1: 1 }, attention: 0 }).level).toBe("act");
  });
  it("asks for a check when incidents are open but within SLA", () => {
    expect(incidentsTriage({ open: { ...noOpen, P4: 2 }, attention: 0 }).level).toBe("check");
  });
  it("is calm with no open incidents", () => {
    expect(incidentsTriage({ open: noOpen, attention: 0 }).level).toBe("ok");
  });
});

describe("sourcesTriage", () => {
  it("is unknown, never calm, when the Wazuh pull is stale", () => {
    expect(sourcesTriage({ connectorFresh: false, statuses: ["healthy"] }).level).toBe("unknown");
  });
  it("is unknown when no sources are registered", () => {
    expect(sourcesTriage({ connectorFresh: true, statuses: [] }).level).toBe("unknown");
  });
  it("asks for action when a source has gone silent", () => {
    expect(sourcesTriage({ connectorFresh: true, statuses: ["healthy", "stale", "unknown"] }).level).toBe("act");
  });
  it("is unknown when a source has never reported", () => {
    expect(sourcesTriage({ connectorFresh: true, statuses: ["healthy", "unknown"] }).level).toBe("unknown");
  });
  it("is calm only when every source is healthy", () => {
    expect(sourcesTriage({ connectorFresh: true, statuses: ["healthy", "healthy"] }).level).toBe("ok");
  });
});

describe("backupsTriage", () => {
  it("is unknown when no jobs are tracked", () => {
    expect(backupsTriage({ healths: [], unverified: 0 }).level).toBe("unknown");
  });
  it("asks for action on a failing, stale or unencrypted job", () => {
    for (const bad of ["failing", "stale", "unencrypted"] as const)
      expect(backupsTriage({ healths: ["ok", bad], unverified: 0 }).level).toBe("act");
  });
  it("is unknown when a job has no data", () => {
    expect(backupsTriage({ healths: ["ok", "unknown"], unverified: 0 }).level).toBe("unknown");
  });
  it("asks for a check when backups run but recovery is unverified", () => {
    expect(backupsTriage({ healths: ["ok"], unverified: 1 }).level).toBe("check");
  });
  it("is calm when every job is on schedule and recovery is verified", () => {
    expect(backupsTriage({ healths: ["ok"], unverified: 0 }).level).toBe("ok");
  });
});

describe("portsTriage", () => {
  it("asks for action on an unapproved exposure even if the scan is old", () => {
    expect(portsTriage({ scanStatus: "stale", openExposures: 1 }).level).toBe("act");
  });
  it("is unknown without a current scan", () => {
    expect(portsTriage({ scanStatus: "missing", openExposures: 0 }).level).toBe("unknown");
    expect(portsTriage({ scanStatus: "stale", openExposures: 0 }).level).toBe("unknown");
  });
  it("is calm with a current scan and nothing unapproved", () => {
    expect(portsTriage({ scanStatus: "fresh", openExposures: 0 }).level).toBe("ok");
  });
});

describe("wafTriage", () => {
  it("is calm only with fresh sampled data", () => {
    expect(wafTriage({ status: "fresh" }).level).toBe("ok");
    for (const status of ["stale", "error", "unavailable"] as const) expect(wafTriage({ status }).level).toBe("unknown");
  });
});

describe("duoTriage", () => {
  it("maps the manual check schedule", () => {
    expect(duoTriage({ state: "current" }).level).toBe("ok");
    expect(duoTriage({ state: "overdue" }).level).toBe("check");
    expect(duoTriage({ state: "never_checked" }).level).toBe("unknown");
  });
});

describe("notificationsTriage", () => {
  it("asks for action when no channel is configured", () => {
    expect(notificationsTriage({ channels: 0, failures: 0 }).level).toBe("act");
  });
  it("asks for action when deliveries are failing", () => {
    expect(notificationsTriage({ channels: 2, failures: 1 }).level).toBe("act");
  });
  it("is calm when channels are configured and delivering", () => {
    expect(notificationsTriage({ channels: 1, failures: 0 }).level).toBe("ok");
  });
});
