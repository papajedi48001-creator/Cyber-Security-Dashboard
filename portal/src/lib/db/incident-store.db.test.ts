import { afterAll, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { createIncidentService } from "../incidents/service";
import { PrismaIncidentStore } from "./incident-store";
import { testDatabaseUrl, testPrisma } from "./test-db";

describe.skipIf(!testDatabaseUrl)("PrismaIncidentStore (MariaDB)", () => {
  const prisma = testPrisma();
  afterAll(() => prisma?.$disconnect());

  it("numbers concurrent incidents uniquely and keeps the workflow consistent", async () => {
    const run = Date.now();
    const owner = await prisma.user.create({
      data: { username: `owner-${run}`, displayName: "Owner", role: "SECURITY_OPERATOR", passwordHash: "x" },
    });
    const reviewer = { id: `reviewer-${run}`, username: "reviewer", role: "SECURITY_ADMINISTRATOR" as const };
    const actor = { id: owner.id, username: owner.username, role: "SECURITY_OPERATOR" as const };
    const service = createIncidentService({ store: new PrismaIncidentStore(prisma), audit: createAuditLog(new InMemoryAuditStore()) });

    const created = await Promise.all(
      [1, 2, 3].map(() => service.createIncident(actor, { title: "db test", severity: "P2", detectedAt: new Date() }, "c")),
    );
    expect(new Set(created.map((i) => i.number)).size).toBe(3);

    const id = created[0]!.id;
    await expect(service.assignIncident(actor, id, `missing-${run}`, "c")).rejects.toThrow();
    await service.assignIncident(actor, id, owner.id, "c");
    await service.acknowledgeIncident(actor, id, "c");
    await service.transitionIncident(actor, id, "INVESTIGATING", "c");
    await service.transitionIncident(actor, id, "MITIGATED", "c");
    await service.submitClosureEvidence(actor, id, { cause: "c", remediation: "r", summary: "s", reference: "ref" }, "c");
    const closed = await service.reviewClosure(reviewer, id, { approve: true, note: "ok" }, "c");
    expect(closed.status).toBe("CLOSED");

    const detail = await service.getIncidentDetail(actor, id);
    expect(detail.timeline.map((t) => t.type)).toEqual([
      "created", "assigned", "acknowledged", "status_changed", "status_changed", "closure_submitted", "closure_approved",
    ]);
    expect(detail.evidence).toMatchObject({ decision: "APPROVED", reviewedById: reviewer.id });
  });

  it("refuses a stale status change", async () => {
    const store = new PrismaIncidentStore(prisma);
    const service = createIncidentService({ store, audit: createAuditLog(new InMemoryAuditStore()) });
    const actor = { id: "admin", username: "admin", role: "SECURITY_ADMINISTRATOR" as const };
    const incident = await service.createIncident(actor, { title: "race", severity: "P3", detectedAt: new Date() }, "c");
    const entry = { at: new Date(), actorId: null, type: "test", note: null };
    expect(await store.applyChange(incident.id, "ASSIGNED", { status: "ACKNOWLEDGED" }, entry)).toBeNull();
  });
});
