import { describe, expect, it } from "vitest";
import { createWorkerCycles, type WorkerDeps } from "./cycles";

const okPoll = { status: "ok" as const, fetched: 2, created: 1, duplicates: 1, malformed: 0, newAlerts: [] };

function deps(overrides: Partial<WorkerDeps> = {}) {
  const logs: { event: string; detail: Record<string, unknown> }[] = [];
  const base: WorkerDeps = {
    poll: async () => okPoll,
    incidents: {
      raisePending: async () => [{ number: "INC-2026-0001" }] as never,
      raiseSourceHealth: async (sources) => sources.map((s) => ({ number: `INC-${s.name}` })) as never,
      raiseFindings: async (_label, findings) => findings.map((f) => ({ number: `INC-${f.sourceName}` })) as never,
    },
    portFindings: async () => [
      { category: "external_exposure", sourceName: "203.0.113.10:3389/TCP", severity: "P2", title: "RDP", detectedAt: new Date() },
    ],
    refreshWaf: async () => ({ status: "ok", total: 5 }),
    notifier: { dispatchDue: async () => ({ sent: 2, failed: 0 }) },
    silentSources: async () => [{ name: "sophos-firewall", critical: true, reason: "silent", since: new Date() }],
    log: (event, detail) => logs.push({ event, detail }),
    newCorrelationId: () => "corr",
    ...overrides,
  };
  return { cycles: createWorkerCycles(base), logs };
}

describe("worker cycles", () => {
  it("polls Wazuh and raises incidents from pending alerts", async () => {
    const { cycles, logs } = deps();
    await cycles.intake();
    expect(logs[0]).toMatchObject({ event: "intake", detail: { status: "ok", created: 1, incidentsRaised: ["INC-2026-0001"] } });
  });

  it("still raises pending alerts when the poll fails", async () => {
    const { cycles, logs } = deps({ poll: async () => ({ ...okPoll, status: "error", error: "Indexer unreachable" }) });
    await cycles.intake();
    expect(logs[0]!.detail).toMatchObject({ status: "error", incidentsRaised: ["INC-2026-0001"] });
  });

  it("opens source-health incidents for silent sources", async () => {
    const { cycles, logs } = deps();
    await cycles.sourceHealth();
    expect(logs[0]).toMatchObject({ event: "source_health", detail: { incidentsRaised: ["INC-sophos-firewall"] } });
  });

  it("opens incidents for port findings", async () => {
    const { cycles, logs } = deps();
    await cycles.ports();
    expect(logs[0]).toMatchObject({ event: "ports", detail: { findings: 1, incidentsRaised: ["INC-203.0.113.10:3389/TCP"] } });
  });

  it("logs a failing cycle without throwing or leaking secrets", async () => {
    const { cycles, logs } = deps({
      notifier: {
        dispatchDue: async () => {
          throw new Error("connect failed password=hunter2");
        },
      },
    });
    await expect(cycles.notifications()).resolves.toBeUndefined();
    expect(logs[0]!.event).toBe("notifications.error");
    expect(JSON.stringify(logs)).not.toContain("hunter2");
  });

  it("imports the backup evidence inbox", async () => {
    const { cycles, logs } = deps({ importBackupInbox: async () => ({ files: 1, imported: 3, rejected: 0, oversized: 0 }) });
    await cycles.backupInbox();
    expect(logs[0]).toMatchObject({ event: "backup_inbox", detail: { files: 1, imported: 3 } });
  });

  it("hands held destroy requests to GDCC and records outcomes when files are configured", async () => {
    const off = deps();
    await off.cycles.backupFiles();
    expect(off.logs[0]).toMatchObject({ event: "backup_files", detail: { status: "not_configured" } });
    const on = deps({ syncBackupFiles: async () => ({ state: "fresh", sent: 1, completed: 0, closed: 0 }) });
    await on.cycles.backupFiles();
    expect(on.logs[0]).toMatchObject({ event: "backup_files", detail: { state: "fresh", sent: 1 } });
  });

  it("checks each replica and opens an incident for a finding", async () => {
    const finding = { category: "replica_health", sourceName: "hosxp-db-replica", severity: "P3" as const, title: "replica", detectedAt: new Date() };
    const raised: string[] = [];
    const { cycles, logs } = deps({
      checkReplicas: [
        { source: "portal-db-replica", check: async () => ({ check: { state: "healthy", lagSeconds: 0, consecutiveFailures: 0 }, finding: null }) },
        { source: "hosxp-db-replica", check: async () => ({ check: { state: "broken", lagSeconds: null, consecutiveFailures: 2 }, finding }) },
      ],
      incidents: {
        raisePending: async () => [],
        raiseSourceHealth: async () => [],
        raiseFindings: async (label, findings) => {
          raised.push(label);
          return findings.map((f) => ({ number: `INC-${f.sourceName}` })) as never;
        },
      },
    });
    await cycles.replica();
    expect(raised).toEqual(["system:replica-monitor"]);
    expect(logs[0]).toMatchObject({
      event: "replica",
      detail: {
        replicas: [
          { source: "portal-db-replica", state: "healthy", incidentsRaised: [] },
          { source: "hosxp-db-replica", state: "broken", incidentsRaised: ["INC-hosxp-db-replica"] },
        ],
      },
    });
  });
});
