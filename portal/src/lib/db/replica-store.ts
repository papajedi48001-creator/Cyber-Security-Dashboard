import { PrismaClient } from "@prisma/client";
import { REPLICA_SOURCE, type ReplicaStore } from "../replica/service";
import type { ReplicaCheck, ReplicaState } from "../replica/status";

export class PrismaReplicaStore implements ReplicaStore {
  constructor(private readonly db: PrismaClient, private readonly name = REPLICA_SOURCE) {}

  async latest(): Promise<ReplicaCheck | null> {
    const row = await this.db.replicaCheck.findUnique({ where: { name: this.name } });
    if (!row) return null;
    const { name: _name, state, ...rest } = row;
    return { ...rest, state: state as ReplicaState };
  }

  async save(check: ReplicaCheck): Promise<void> {
    const data = { ...check, error: check.error?.slice(0, 255) ?? null };
    await this.db.replicaCheck.upsert({ where: { name: this.name }, create: { name: this.name, ...data }, update: data });
  }
}

/**
 * Reads SHOW REPLICA STATUS with the monitor-only account. A short connect
 * timeout keeps an unreachable replica from stalling the worker.
 */
export function replicaStatusReader(url: string) {
  const withTimeout = new URL(url);
  if (!withTimeout.searchParams.has("connect_timeout")) withTimeout.searchParams.set("connect_timeout", "5");
  if (!withTimeout.searchParams.has("connection_limit")) withTimeout.searchParams.set("connection_limit", "1");
  const client = new PrismaClient({ datasourceUrl: withTimeout.toString() });
  return async (): Promise<Record<string, unknown> | null> => {
    try {
      const rows = await client.$queryRaw<Record<string, unknown>[]>`SHOW REPLICA STATUS`;
      return rows[0] ?? null;
    } catch (error) {
      await client.$disconnect().catch(() => undefined);
      throw error;
    }
  };
}
