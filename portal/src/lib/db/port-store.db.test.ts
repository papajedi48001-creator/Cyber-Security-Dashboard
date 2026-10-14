import { afterAll, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { createPortMonitorService } from "../port-monitor/service";
import { PrismaPortStore } from "./port-store";
import { testDatabaseUrl, testPrisma } from "./test-db";

describe.skipIf(!testDatabaseUrl)("PrismaPortStore (MariaDB)", () => {
  const prisma = testPrisma();
  afterAll(() => prisma?.$disconnect());

  it("round-trips scans, firewall rules and exceptions", async () => {
    const admin = { id: "admin", username: "admin", role: "SECURITY_ADMINISTRATOR" as const };
    const service = createPortMonitorService({ store: new PrismaPortStore(prisma), audit: createAuditLog(new InMemoryAuditStore()) });
    const finishedAt = new Date(Date.now() - 1000).toISOString();
    await service.importExposureScan(
      admin,
      JSON.stringify({
        format: "external-exposure-scan/v1", scanner: "nmap", startedAt: finishedAt, finishedAt,
        targets: ["203.0.113.20"], findings: [{ address: "203.0.113.20", port: 3389, protocol: "tcp", service: "ms-wbt-server" }],
      }),
      "c",
    );
    await service.importFirewallRules(admin, "RDP NAT,203.0.113.20,3389,TCP", "c");
    const ex = await service.addException(
      admin,
      { family: "EXTERNAL_EXPOSURE", address: "203.0.113.20", port: 3389, protocol: "TCP", reason: "db test", owner: "IT", expiresAt: new Date(Date.now() + 86_400_000) },
      "c",
    );
    let snap = await service.getSnapshot(admin);
    expect(snap.exposures.find((f) => f.address === "203.0.113.20")).toMatchObject({ classification: "APPROVED", inFirewallRules: true });
    await service.revokeException(admin, ex.id, "c");
    snap = await service.getSnapshot(admin);
    expect(snap.exposures.find((f) => f.address === "203.0.113.20")).toMatchObject({ classification: "UNAPPROVED", severity: "P2" });
  });
});
