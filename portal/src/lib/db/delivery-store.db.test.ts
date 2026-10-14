import { afterAll, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { createIncidentService } from "../incidents/service";
import { createNotifier, type NotificationChannel } from "../notifications/delivery";
import { PrismaDeliveryStore } from "./delivery-store";
import { PrismaIncidentStore } from "./incident-store";
import { testDatabaseUrl, testPrisma } from "./test-db";

describe.skipIf(!testDatabaseUrl)("PrismaDeliveryStore (MariaDB)", () => {
  const prisma = testPrisma();
  afterAll(() => prisma?.$disconnect());

  it("persists queued, failed and sent deliveries without secrets", async () => {
    const audit = createAuditLog(new InMemoryAuditStore());
    const incidents = createIncidentService({ store: new PrismaIncidentStore(prisma), audit });
    const admin = { id: "admin", username: "admin", role: "SECURITY_ADMINISTRATOR" as const };
    const incident = await incidents.createIncident(admin, { title: "db", severity: "P1", detectedAt: new Date() }, "c");

    let lineDown = true;
    const channels: NotificationChannel[] = [
      { name: "EMAIL", send: async () => {} },
      { name: "LINE", send: async () => { if (lineDown) throw new Error("LINE HTTP 503"); } },
    ];
    let now = new Date();
    const store = new PrismaDeliveryStore(prisma);
    const notifier = createNotifier({ store, channels, audit, portalBaseUrl: "https://portal", clock: () => now });

    await notifier.enqueue(incident, "incident.opened", "c");
    await notifier.enqueue(incident, "incident.opened", "c");
    await notifier.dispatchDue("c");
    const rows = await prisma.notificationDelivery.findMany({ where: { incidentId: incident.id } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.channel === "LINE")).toMatchObject({ status: "FAILED", lastError: "LINE HTTP 503" });
    expect((await notifier.openFailures()).some((f) => f.incidentNumber === incident.number)).toBe(true);

    lineDown = false;
    now = new Date(now.getTime() + 6 * 60_000);
    await notifier.dispatchDue("c");
    const line = await prisma.notificationDelivery.findFirst({ where: { incidentId: incident.id, channel: "LINE" } });
    expect(line).toMatchObject({ status: "SENT", attempts: 2 });
  });
});
