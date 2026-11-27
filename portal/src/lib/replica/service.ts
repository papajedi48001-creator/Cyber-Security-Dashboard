// Checks each replication connection on the GDCC replica (Portal, ADR 0009;
// HOSxP, ADR 0010) with a monitor-only account and keeps the latest result. Two consecutive bad checks produce a P3 finding; the
// incident service deduplicates while an incident is active.

import { evaluateReplicaStatus, sanitizeReplicaError, type ReplicaCheck, type ReplicaObservation } from "./status";

export const REPLICA_INCIDENT_AFTER_CHECKS = 2;

/** One monitored replication connection: its stored check name and incident source, and what it copies. */
export interface ReplicaTarget {
  source: string;
  subject: string;
}

export const PORTAL_REPLICA: ReplicaTarget = { source: "portal-db-replica", subject: "ฐานข้อมูล Portal" };
export const HOSXP_REPLICA: ReplicaTarget = { source: "hosxp-db-replica", subject: "ฐานข้อมูล HOSxP" };
export const REPLICA_SOURCE = PORTAL_REPLICA.source;

/** The Portal replica is always listed (so an unset monitor shows "not configured"); HOSxP only when its connection is set. */
export function replicaTargets(connections: { portalConnection: string; hosxpConnection?: string }) {
  const targets: (ReplicaTarget & { connection: string })[] = [{ ...PORTAL_REPLICA, connection: connections.portalConnection }];
  if (connections.hosxpConnection !== undefined) targets.push({ ...HOSXP_REPLICA, connection: connections.hosxpConnection });
  return targets;
}

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

const TITLES: Record<Exclude<ReplicaObservation["state"], "healthy">, (subject: string) => string> = {
  lagging: (subject) => `replica ${subject} ที่ GDCC ล่าช้า`,
  broken: (subject) => `replica ${subject} ที่ GDCC หยุดทำงาน`,
  unavailable: (subject) => `เชื่อมต่อ replica ${subject} ที่ GDCC ไม่ได้`,
};

export function createReplicaMonitor({
  target = PORTAL_REPLICA,
  fetchStatus,
  store,
  clock = () => new Date(),
}: {
  target?: ReplicaTarget;
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
          ? { category: "replica_health" as const, sourceName: target.source, severity: "P3" as const, title: TITLES[observation.state](target.subject), detectedAt: checkedAt }
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
