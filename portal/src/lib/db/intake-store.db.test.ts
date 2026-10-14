import { afterAll, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import type { IndexerHit } from "../wazuh/normalize-alert";
import { pollWazuhAlerts } from "../wazuh/poller";
import { PrismaIntakeStore } from "./intake-store";
import { testDatabaseUrl, testPrisma } from "./test-db";

describe.skipIf(!testDatabaseUrl)("PrismaIntakeStore (MariaDB)", () => {
  const prisma = testPrisma();
  afterAll(() => prisma?.$disconnect());

  it("deduplicates repeated deliveries and stores no raw payload", async () => {
    const run = Date.now();
    const hit: IndexerHit = {
      _id: `db-alert-${run}`,
      _source: {
        timestamp: new Date().toISOString(),
        rule: { id: "100150", level: 10, description: "Sophos: IPS", groups: ["sophos", "ips_av_web_event"] },
        decoder: { name: "sophos-sfos" },
        full_log: "raw-secret-content",
      },
      sort: [run, `db-alert-${run}`],
    };
    const store = new PrismaIntakeStore(prisma);
    const deps = {
      store,
      audit: createAuditLog(new InMemoryAuditStore()),
      dashboardUrl: "https://wazuh.example",
      source: { searchAlerts: async () => [hit] },
    };
    await pollWazuhAlerts(deps);
    const second = await pollWazuhAlerts(deps);
    expect(second.duplicates).toBe(1);
    const rows = await prisma.alertReference.findMany({ where: { wazuhAlertId: hit._id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deliveryCount).toBe(2);
    expect(JSON.stringify(rows)).not.toContain("raw-secret-content");
  });
});
