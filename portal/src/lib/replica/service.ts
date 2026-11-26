// Checks the GDCC Portal MariaDB replica with a monitor-only account and keeps
// the latest result. Two consecutive bad checks produce a P3 finding; the
// incident service deduplicates while an incident is active.

import { evaluateReplicaStatus, sanitizeReplicaError, type ReplicaCheck, type ReplicaObservation } from "./status";

export const REPLICA_SOURCE = "portal-db-replica";
export const REPLICA_INCIDENT_AFTER_CHECKS = 2;

export interface ReplicaStore {
  latest(): Promise<ReplicaCheck | null>;
  save(check: ReplicaCheck): Promise<void>;
}

export interface ReplicaFinding {
  category: "replica_health";
  sourceName: string;
  severity: "P3";
  title: string;
  detectedAt: Date;
}

const TITLES: Record<Exclude<ReplicaObservation["state"], "healthy">, string> = {
  lagging: "replica ฐานข้อมูล Portal ที่ GDCC ล่าช้า",
  broken: "replica ฐานข้อมูล Portal ที่ GDCC หยุดทำงาน",
  unavailable: "เชื่อมต่อ replica ฐานข้อมูล Portal ที่ GDCC ไม่ได้",
};

export function createReplicaMonitor({
  fetchStatus,
  store,
  clock = () => new Date(),
}: {
  fetchStatus: () => Promise<Record<string, unknown> | null>;
  store: ReplicaStore;
  clock?: () => Date;
}) {
  return {
    async check(): Promise<{ check: ReplicaCheck; finding: ReplicaFinding | null }> {
      let observation: ReplicaObservation;
      try {
        observation = evaluateReplicaStatus(await fetchStatus());
      } catch (error) {
        observation = { state: "unavailable", lagSeconds: null, ioRunning: false, sqlRunning: false, error: sanitizeReplicaError(error) };
      }
      const previous = await store.latest();
      const checkedAt = clock();
      const consecutiveFailures = observation.state === "healthy" ? 0 : (previous?.consecutiveFailures ?? 0) + 1;
      const check: ReplicaCheck = { ...observation, consecutiveFailures, checkedAt };
      await store.save(check);
      const finding =
        observation.state !== "healthy" && consecutiveFailures >= REPLICA_INCIDENT_AFTER_CHECKS
          ? { category: "replica_health" as const, sourceName: REPLICA_SOURCE, severity: "P3" as const, title: TITLES[observation.state], detectedAt: checkedAt }
          : null;
      return { check, finding };
    },
  };
}

export type ReplicaMonitor = ReturnType<typeof createReplicaMonitor>;

export class InMemoryReplicaStore implements ReplicaStore {
  private current: ReplicaCheck | null = null;
  async latest() {
    return this.current;
  }
  async save(check: ReplicaCheck) {
    this.current = check;
  }
}
