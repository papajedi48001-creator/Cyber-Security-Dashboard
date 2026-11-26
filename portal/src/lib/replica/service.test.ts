import { describe, expect, it } from "vitest";
import { createReplicaMonitor, InMemoryReplicaStore } from "./service";

const NOW = new Date("2026-11-26T10:00:00Z");
const ok = { Slave_IO_Running: "Yes", Slave_SQL_Running: "Yes", Seconds_Behind_Master: 0 };
const broken = { Slave_IO_Running: "No", Slave_SQL_Running: "Yes", Seconds_Behind_Master: null, Last_IO_Error: "lost" };

function monitor(rows: (Record<string, unknown> | null | Error)[]) {
  const store = new InMemoryReplicaStore();
  let i = 0;
  const m = createReplicaMonitor({
    fetchStatus: async () => {
      const row = rows[i++]!;
      if (row instanceof Error) throw row;
      return row;
    },
    store,
    clock: () => NOW,
  });
  return { m, store };
}

describe("replica monitor", () => {
  it("stores each check and resets failures when healthy", async () => {
    const { m, store } = monitor([broken, ok]);
    expect((await m.check()).check.consecutiveFailures).toBe(1);
    const { check, finding } = await m.check();
    expect(check).toMatchObject({ state: "healthy", consecutiveFailures: 0, checkedAt: NOW });
    expect(finding).toBeNull();
    expect(await store.latest()).toEqual(check);
  });

  it("raises a P3 finding only from the second consecutive bad check", async () => {
    const { m } = monitor([broken, new Error("connect ECONNREFUSED mysql://u:hunter2@h/"), broken]);
    expect((await m.check()).finding).toBeNull();
    const second = await m.check();
    expect(second.check).toMatchObject({ state: "unavailable", consecutiveFailures: 2 });
    expect(second.check.error).not.toContain("hunter2");
    expect(second.finding).toEqual({
      category: "replica_health",
      sourceName: "portal-db-replica",
      severity: "P3",
      title: expect.stringContaining("replica"),
      detectedAt: NOW,
    });
    expect((await m.check()).finding).not.toBeNull();
  });
});
