import { afterAll, describe, expect, it } from "vitest";
import { createReplicaMonitor } from "../replica/service";
import { PrismaReplicaStore, replicaStatusReader } from "./replica-store";
import { testDatabaseUrl, testPrisma } from "./test-db";

describe.skipIf(!testDatabaseUrl)("PrismaReplicaStore (MariaDB)", () => {
  const prisma = testPrisma();
  afterAll(() => prisma?.$disconnect());

  it("keeps one latest check per replica", async () => {
    const store = new PrismaReplicaStore(prisma, `test-${Date.now().toString(36)}`);
    const base = { lagSeconds: 3, ioRunning: true, sqlRunning: true, error: null, checkedAt: new Date("2026-11-26T10:00:00Z") };
    await store.save({ ...base, state: "healthy", consecutiveFailures: 0 });
    await store.save({ ...base, state: "broken", consecutiveFailures: 1, error: "x".repeat(400) });
    expect(await store.latest()).toMatchObject({ state: "broken", consecutiveFailures: 1 });
    expect((await store.latest())!.error).toHaveLength(255);
  });

  it("reports a server that is not a replica as unavailable", async () => {
    // The CI MariaDB is a standalone server; SHOW ALL REPLICAS STATUS returns no
    // "hosxp" row (or is refused for an account without the monitor privilege).
    const monitor = createReplicaMonitor({
      fetchStatus: replicaStatusReader(testDatabaseUrl!)("hosxp"),
      store: new PrismaReplicaStore(prisma, `test-${Date.now().toString(36)}-r`),
    });
    const { check } = await monitor.check();
    expect(check.state).toBe("unavailable");
    expect(check.error).not.toContain("ci-test-only");
  });
});
