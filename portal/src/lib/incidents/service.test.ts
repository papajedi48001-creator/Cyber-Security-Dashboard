import { beforeEach, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { ForbiddenError } from "../auth/authorize";
import type { NormalizedAlert } from "../wazuh/normalize-alert";
import { createIncidentService, IncidentRuleError, InMemoryIncidentStore, type IncidentService } from "./service";

const NOW = new Date("2026-10-14T03:00:00Z");
const admin = { id: "admin", username: "admin", role: "SECURITY_ADMINISTRATOR" as const };
const opA = { id: "opA", username: "op.a", role: "SECURITY_OPERATOR" as const };
const opB = { id: "opB", username: "op.b", role: "SECURITY_OPERATOR" as const };
const exec = { id: "exec", username: "exec", role: "EXECUTIVE_VIEWER" as const };

let auditStore: InMemoryAuditStore;
let store: InMemoryIncidentStore;
let service: IncidentService;
let now: Date;

beforeEach(() => {
  now = NOW;
  auditStore = new InMemoryAuditStore();
  store = new InMemoryIncidentStore();
  service = createIncidentService({ store, audit: createAuditLog(auditStore, () => now), clock: () => now });
});

const create = (severity: "P1" | "P2" | "P3" | "P4" = "P1") =>
  service.createIncident(opA, { title: "Suspicious admin login", severity, detectedAt: NOW }, "c");

async function toMitigated(severity: "P1" | "P2" | "P3" | "P4") {
  const incident = await create(severity);
  await service.assignIncident(opA, incident.id, opA.id, "c");
  await service.acknowledgeIncident(opA, incident.id, "c");
  await service.transitionIncident(opA, incident.id, "INVESTIGATING", "c");
  await service.transitionIncident(opA, incident.id, "MITIGATED", "c");
  return incident;
}

describe("incident lifecycle", () => {
  it("numbers incidents and computes the acknowledge target from severity", async () => {
    const first = await create("P1");
    const second = await create("P2");
    expect(first.number).toBe("INC-2026-0001");
    expect(second.number).toBe("INC-2026-0002");
    expect(first.acknowledgeDue).toEqual(new Date("2026-10-14T03:15:00Z"));
    expect(second.acknowledgeDue).toEqual(new Date("2026-10-14T04:00:00Z"));
  });

  it("follows Assigned -> Acknowledged -> Investigating -> Mitigated", async () => {
    const incident = await toMitigated("P3");
    const current = await service.getIncident(opA, incident.id);
    expect(current.status).toBe("MITIGATED");
    expect(current.acknowledgedAt).toEqual(NOW);
    expect(current.mitigatedAt).toEqual(NOW);
  });

  it("writes exactly one audit record per mutation", async () => {
    await toMitigated("P3");
    expect(auditStore.records.map((r) => r.action)).toEqual([
      "incident.created",
      "incident.assigned",
      "incident.acknowledged",
      "incident.status_changed",
      "incident.status_changed",
    ]);
    expect(store.timeline).toHaveLength(5);
  });

  it("rejects invalid transitions", async () => {
    const incident = await create();
    await expect(service.acknowledgeIncident(opA, incident.id, "c")).rejects.toBeInstanceOf(IncidentRuleError);
    await expect(service.transitionIncident(opA, incident.id, "MITIGATED", "c")).rejects.toBeInstanceOf(IncidentRuleError);
    await expect(service.transitionIncident(opA, incident.id, "CLOSED", "c")).rejects.toBeInstanceOf(IncidentRuleError);
    expect(auditStore.records).toHaveLength(1);
  });

  it("only lets the assigned owner acknowledge", async () => {
    const incident = await create();
    await service.assignIncident(opA, incident.id, opA.id, "c");
    await expect(service.acknowledgeIncident(opB, incident.id, "c")).rejects.toBeInstanceOf(IncidentRuleError);
  });

  it("records severity changes and recomputes the target", async () => {
    const incident = await create("P4");
    const updated = await service.changeSeverity(opA, incident.id, "P1", "Affects HOSxP", "c");
    expect(updated.severity).toBe("P1");
    expect(updated.acknowledgeDue).toEqual(new Date("2026-10-14T03:15:00Z"));
    expect(auditStore.records.at(-1)).toMatchObject({ action: "incident.severity_changed", metadata: { from: "P4", to: "P1" } });
  });
});

describe("closure", () => {
  it("closes P3/P4 with cause, remediation, closer and time", async () => {
    const incident = await toMitigated("P3");
    await expect(service.closeIncident(opA, incident.id, { cause: "", remediation: "x" }, "c")).rejects.toBeInstanceOf(
      IncidentRuleError,
    );
    const closed = await service.closeIncident(opA, incident.id, { cause: "Weak password", remediation: "Reset and MFA" }, "c");
    expect(closed).toMatchObject({ status: "CLOSED", closedById: opA.id, cause: "Weak password" });
    expect(closed.closedAt).toEqual(NOW);
  });

  it("requires Closure Evidence and a separate reviewer for P1/P2", async () => {
    const incident = await toMitigated("P1");
    await expect(
      service.closeIncident(opA, incident.id, { cause: "c", remediation: "r" }, "c"),
    ).rejects.toBeInstanceOf(IncidentRuleError);
    await service.submitClosureEvidence(
      opA,
      incident.id,
      { cause: "Exposed RDP", remediation: "Closed port", summary: "Re-scan shows port closed", reference: "scan-2026-10-14.pdf" },
      "c",
    );
    expect((await service.getIncident(opA, incident.id)).status).toBe("PENDING_REVIEW");
    await expect(service.reviewClosure(opA, incident.id, { approve: true, note: "" }, "c")).rejects.toBeInstanceOf(
      IncidentRuleError,
    );
    const closed = await service.reviewClosure(opB, incident.id, { approve: true, note: "Evidence verified" }, "c");
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedById).toBe(opB.id);
  });

  it("does not let the owner review even if someone else submitted the evidence", async () => {
    const incident = await toMitigated("P2");
    await service.submitClosureEvidence(opB, incident.id, { cause: "c", remediation: "r", summary: "s", reference: "ref" }, "c");
    await expect(service.reviewClosure(opA, incident.id, { approve: true, note: "" }, "c")).rejects.toBeInstanceOf(
      IncidentRuleError,
    );
    expect((await service.reviewClosure(admin, incident.id, { approve: true, note: "ok" }, "c")).status).toBe("CLOSED");
  });

  it("returns a rejected review to Investigating", async () => {
    const incident = await toMitigated("P1");
    await service.submitClosureEvidence(opA, incident.id, { cause: "c", remediation: "r", summary: "s", reference: "ref" }, "c");
    const back = await service.reviewClosure(opB, incident.id, { approve: false, note: "Need post-fix logs" }, "c");
    expect(back.status).toBe("INVESTIGATING");
    await expect(service.reviewClosure(opB, incident.id, { approve: false, note: "" }, "c")).rejects.toBeInstanceOf(
      IncidentRuleError,
    );
  });
});

describe("authorization", () => {
  it("denies Executive Viewer every incident operation, including reading technical detail", async () => {
    const incident = await create();
    await expect(service.createIncident(exec, { title: "t", severity: "P1", detectedAt: NOW }, "c")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.getIncident(exec, incident.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.listIncidents(exec, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.assignIncident(exec, incident.id, opA.id, "c")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("hides missing and forbidden incidents behind the same error", async () => {
    await expect(service.getIncident(exec, "does-not-exist")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.getIncident(opA, "does-not-exist")).rejects.toBeInstanceOf(IncidentRuleError);
  });
});

describe("raising incidents from Wazuh alerts", () => {
  const alert = (id: string, level: number, category: NormalizedAlert["category"], minutes = 0): NormalizedAlert => ({
    wazuhAlertId: id,
    ruleId: 100150,
    ruleLevel: level,
    category,
    description: "Sophos: IPS event",
    sourceName: "sophos-firewall",
    detectedAt: new Date(NOW.getTime() + minutes * 60_000),
    investigationUrl: "https://wazuh/x",
  });

  it("raises an incident for P1/P2-level alerts and links the alert", async () => {
    const raised = await service.raiseFromAlerts([alert("a1", 10, "ips_av_web_event")], "c");
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ severity: "P2", category: "ips_av_web_event", sourceName: "sophos-firewall", status: "NEW" });
    expect(store.links.get("a1")).toBe(raised[0]!.id);
    expect(auditStore.records[0]).toMatchObject({ actorLabel: "system:wazuh-intake", action: "incident.created" });
  });

  it("groups repeated alerts of the same category and source into the open incident", async () => {
    await service.raiseFromAlerts([alert("a1", 10, "ips_av_web_event")], "c");
    const again = await service.raiseFromAlerts([alert("a2", 10, "ips_av_web_event", 20)], "c");
    expect(again).toHaveLength(0);
    expect(store.incidents.size).toBe(1);
    expect(store.links.get("a2")).toBe(store.links.get("a1"));
  });

  it("leaves lower-level alerts as Security Events for triage", async () => {
    const raised = await service.raiseFromAlerts([alert("a1", 5, "blocked_traffic"), alert("a2", 8, "vpn_anomaly")], "c");
    expect(raised).toHaveLength(0);
  });

  it("raises pending stored alerts that an interrupted intake left unlinked", async () => {
    store.alertRefs.set("a9", { ...alert("a9", 13, "firewall_rule_change", -30), incidentId: null });
    store.alertRefs.set("a10", { ...alert("a10", 5, "blocked_traffic", -30), incidentId: null });
    const raised = await service.raisePending("c");
    expect(raised.map((i) => i.severity)).toEqual(["P1"]);
    expect(await service.raisePending("c")).toHaveLength(0);
  });

  it("lets an operator promote a Security Event to an incident", async () => {
    store.alertRefs.set("ev1", { ...alert("ev1", 8, "vpn_anomaly"), incidentId: null });
    const incident = await service.promoteAlert(opA, "ev1", "P3", "c");
    expect(incident.severity).toBe("P3");
    expect(store.links.get("ev1")).toBe(incident.id);
  });
});

describe("notifications", () => {
  it("notifies when an incident opens and when its severity is raised, not lowered", async () => {
    const events: string[] = [];
    const notifying = createIncidentService({
      store: new InMemoryIncidentStore(),
      audit: createAuditLog(new InMemoryAuditStore(), () => now),
      clock: () => now,
      notify: async (incident, event) => {
        events.push(`${incident.number}:${event}`);
      },
    });
    const incident = await notifying.createIncident(opA, { title: "t", severity: "P3", detectedAt: NOW }, "c");
    await notifying.changeSeverity(opA, incident.id, "P2", "spreading", "c");
    await notifying.changeSeverity(opB, incident.id, "P4", "false positive", "c");
    expect(events).toEqual(["INC-2026-0001:incident.opened", "INC-2026-0001:severity.P2"]);
  });
});

describe("source health incidents", () => {
  it("opens one incident per silent source and does not duplicate an active one", async () => {
    const silent = [
      { name: "sophos-firewall", critical: true, reason: "ไม่มีข้อมูลมา 20 นาที", since: NOW },
      { name: "wifi-controller", critical: false, reason: "ไม่มีข้อมูลมา 90 นาที", since: NOW },
    ];
    const first = await service.raiseSourceHealth(silent, "c");
    expect(first.map((i) => [i.sourceName, i.severity, i.category])).toEqual([
      ["sophos-firewall", "P2", "log_source_health"],
      ["wifi-controller", "P3", "log_source_health"],
    ]);
    expect(await service.raiseSourceHealth(silent, "c")).toHaveLength(0);
    expect(auditStore.records[0]).toMatchObject({ actorLabel: "system:source-health" });
  });
});
