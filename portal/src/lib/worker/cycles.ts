// Background work run by src/worker.ts: Wazuh intake, source-health incidents
// and notification dispatch. Each cycle is independent; one failing never stops
// the others, and failures are logged without secrets.

import type { IncidentService } from "../incidents/service";
import type { Notifier } from "../notifications/delivery";
import { safeError } from "../notifications/delivery";
import type { SilentSource } from "../source-health";
import type { PollResult } from "../wazuh/poller";

export type WorkerLog = (event: string, detail: Record<string, unknown>) => void;

export interface WorkerDeps {
  poll: () => Promise<PollResult>;
  incidents: Pick<IncidentService, "raisePending" | "raiseSourceHealth" | "raiseFindings">;
  portFindings: () => Promise<Parameters<IncidentService["raiseFindings"]>[1]>;
  refreshWaf: (correlationId: string) => Promise<Record<string, unknown>>;
  notifier: Pick<Notifier, "dispatchDue">;
  /** GDCC backup evidence inbox (optional, ADR 0009). */
  importBackupInbox?: (correlationId: string) => Promise<Record<string, unknown>>;
  /** GDCC replica checks, one per replication connection (optional, ADR 0009 and 0010). */
  checkReplicas?: {
    source: string;
    check: () => Promise<{
      check: { state: string; lagSeconds: number | null; consecutiveFailures: number };
      finding: Parameters<IncidentService["raiseFindings"]>[1][number] | null;
    }>;
  }[];
  silentSources: () => Promise<SilentSource[]>;
  log: WorkerLog;
  newCorrelationId: () => string;
}

export function createWorkerCycles(deps: WorkerDeps) {
  const guarded =
    (name: string, cycle: (correlationId: string) => Promise<Record<string, unknown>>) => async () => {
      const correlationId = deps.newCorrelationId();
      try {
        deps.log(name, { correlationId, ...(await cycle(correlationId)) });
      } catch (error) {
        deps.log(`${name}.error`, { correlationId, error: safeError(error) });
      }
    };

  return {
    intake: guarded("intake", async (correlationId) => {
      const result = await deps.poll();
      // Raise even after a failed poll: alerts stored by an earlier cycle may still be unlinked.
      const raised = await deps.incidents.raisePending(correlationId);
      return {
        status: result.status,
        fetched: result.fetched,
        created: result.created,
        duplicates: result.duplicates,
        malformed: result.malformed,
        incidentsRaised: raised.map((i) => i.number),
        ...(result.error ? { error: result.error } : {}),
      };
    }),

    sourceHealth: guarded("source_health", async (correlationId) => {
      const silent = await deps.silentSources();
      const raised = await deps.incidents.raiseSourceHealth(silent, correlationId);
      return { silent: silent.map((s) => s.name), incidentsRaised: raised.map((i) => i.number) };
    }),

    ports: guarded("ports", async (correlationId) => {
      const findings = await deps.portFindings();
      const raised = await deps.incidents.raiseFindings("system:port-monitor", findings, correlationId);
      return { findings: findings.length, incidentsRaised: raised.map((i) => i.number) };
    }),

    waf: guarded("cloudflare_waf", (correlationId) => deps.refreshWaf(correlationId)),

    notifications: guarded("notifications", async (correlationId) => deps.notifier.dispatchDue(correlationId)),

    backupInbox: guarded("backup_inbox", async (correlationId) => {
      if (!deps.importBackupInbox) return { status: "not_configured" };
      return deps.importBackupInbox(correlationId);
    }),

    replica: guarded("replica", async (correlationId) => {
      if (!deps.checkReplicas?.length) return { status: "not_configured" };
      const replicas = [];
      for (const target of deps.checkReplicas) {
        const { check, finding } = await target.check();
        const raised = finding ? await deps.incidents.raiseFindings("system:replica-monitor", [finding], correlationId) : [];
        replicas.push({
          source: target.source,
          state: check.state,
          lagSeconds: check.lagSeconds,
          consecutiveFailures: check.consecutiveFailures,
          incidentsRaised: raised.map((i) => i.number),
        });
      }
      return { replicas };
    }),
  };
}
