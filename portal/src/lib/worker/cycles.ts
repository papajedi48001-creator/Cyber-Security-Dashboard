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
  notifier: Pick<Notifier, "dispatchDue">;
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

    notifications: guarded("notifications", async (correlationId) => deps.notifier.dispatchDue(correlationId)),
  };
}
