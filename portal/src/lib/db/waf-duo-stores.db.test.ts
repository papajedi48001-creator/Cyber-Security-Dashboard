import { afterAll, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { createWafService } from "../cloudflare/service";
import { createDuoManualCheckService } from "../duo/manual-check";
import { PrismaDuoCheckStore, PrismaWafStore } from "./waf-duo-stores";
import { testDatabaseUrl, testPrisma } from "./test-db";

describe.skipIf(!testDatabaseUrl)("WAF and Duo stores (MariaDB)", () => {
  const prisma = testPrisma();
  afterAll(() => prisma?.$disconnect());
  const admin = { id: "admin", username: "admin", role: "SECURITY_ADMINISTRATOR" as const };

  it("keeps the last good WAF summary and the failure after it", async () => {
    let fail = false;
    const service = createWafService({
      source: {
        fetchSummary: async () => {
          if (fail) throw new Error("Cloudflare API failed (HTTP 502)");
          return { total: 7, byAction: [], byPath: [], byCountry: [], bySource: [], trend: [] };
        },
      },
      store: new PrismaWafStore(prisma),
      audit: createAuditLog(new InMemoryAuditStore()),
    });
    await service.refresh("c");
    expect(await service.getSampledWafSummary(admin)).toMatchObject({ status: "fresh", total: 7, sampled: true });
    fail = true;
    await service.refresh("c");
    expect(await service.getSampledWafSummary(admin)).toMatchObject({ status: "error", total: 7, lastError: "Cloudflare API failed (HTTP 502)" });
    fail = false;
    await service.refresh("c");
    // Leave the shared test database without Cloudflare data, as the e2e run expects.
    await prisma.cloudflareWafSnapshot.deleteMany({});
    await prisma.connectorState.deleteMany({ where: { name: "cloudflare" } });
  });

  it("stores Duo manual checks with their operator", async () => {
    const service = createDuoManualCheckService({ store: new PrismaDuoCheckStore(prisma), audit: createAuditLog(new InMemoryAuditStore()) });
    const checkedAt = new Date(Date.now() - 60_000);
    await service.recordDuoManualCheck(
      admin,
      { checkedAt, authLogReviewed: true, adminActionsReviewed: true, deniedAuthentications: 0, fraudReports: 0, bypassUsers: 0, note: null },
      "c",
    );
    const status = await service.getStatus(admin);
    expect(status.last).toMatchObject({ checkedByName: "admin", issuesFound: false });
    // A newer check here would hide the one the e2e run records.
    await prisma.duoManualCheck.deleteMany({ where: { checkedById: "admin" } });
  });
});
