import { beforeEach, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { ForbiddenError } from "../auth/authorize";
import { createPortMonitorService, InMemoryPortStore, PortPolicyError } from "./service";

let now = new Date("2026-10-14T03:00:00Z");
const admin = { id: "admin", username: "admin", role: "SECURITY_ADMINISTRATOR" as const };
const op = { id: "op", username: "op", role: "SECURITY_OPERATOR" as const };
const exec = { id: "exec", username: "exec", role: "EXECUTIVE_VIEWER" as const };

let store: InMemoryPortStore;
let audit: InMemoryAuditStore;
let service: ReturnType<typeof createPortMonitorService>;

const scan = (findings: { port: number; address?: string }[], finishedAt = "2026-10-14T02:00:00Z") =>
  JSON.stringify({
    format: "external-exposure-scan/v1",
    scanner: "nmap 7.95",
    startedAt: "2026-10-14T01:30:00Z",
    finishedAt,
    targets: ["203.0.113.10", "203.0.113.11"],
    findings: findings.map((f) => ({ address: f.address ?? "203.0.113.10", port: f.port, protocol: "tcp", service: "svc" })),
  });

beforeEach(() => {
  now = new Date("2026-10-14T03:00:00Z");
  store = new InMemoryPortStore();
  audit = new InMemoryAuditStore();
  service = createPortMonitorService({ store, audit: createAuditLog(audit, () => now), clock: () => now });
});

describe("exposure snapshot", () => {
  it("reports a missing scan as unknown instead of no exposure", async () => {
    const snap = await service.getSnapshot(op);
    expect(snap.scan.status).toBe("missing");
    expect(snap.exposures).toEqual([]);
  });

  it("merges scan and firewall rules and classifies each exposure", async () => {
    await service.importExposureScan(op, scan([{ port: 443 }, { port: 3389 }]), "c");
    await service.importFirewallRules(op, "rule_name,public_address,port,protocol\nWeb,203.0.113.10,443,TCP\nOld VPN,203.0.113.11,1194,UDP\nOther,198.51.100.9,22,TCP", "c");
    await service.addException(admin, { family: "EXTERNAL_EXPOSURE", address: "203.0.113.10", port: 443, protocol: "TCP", reason: "Website", owner: "IT", expiresAt: new Date("2027-01-01T00:00:00Z") }, "c");
    const snap = await service.getSnapshot(op);
    expect(snap.scan.status).toBe("fresh");
    expect(snap.exposures.map((f) => [f.port, f.classification, f.severity])).toEqual([
      [3389, "UNAPPROVED", "P2"],
      [1194, "CONFIGURED_NOT_REACHABLE", "P4"],
      [443, "APPROVED", null],
    ]);
    expect(audit.records.map((r) => r.action)).toEqual(["port.scan_imported", "port.firewall_rules_imported", "port.exception_approved"]);
  });

  it("turns an expired exception back into a finding that needs an incident", async () => {
    await service.importExposureScan(op, scan([{ port: 22 }]), "c");
    await service.addException(admin, { family: "EXTERNAL_EXPOSURE", address: "203.0.113.10", port: 22, protocol: "TCP", reason: "Vendor support", owner: "IT", expiresAt: new Date("2026-10-20T00:00:00Z") }, "c");
    expect(await service.findingsForIncidents()).toEqual([]);
    now = new Date("2026-10-21T00:00:00Z");
    const findings = await service.findingsForIncidents();
    expect(findings).toMatchObject([{ category: "external_exposure", severity: "P2", sourceName: "203.0.113.10:22/TCP" }]);
    expect(findings[0]!.title).toContain("ข้อยกเว้นหมดอายุ");
    expect((await service.getSnapshot(op)).scan.status).toBe("stale");
  });

  it("rejects older scans, private addresses and findings outside the targets", async () => {
    await service.importExposureScan(op, scan([]), "c");
    await expect(service.importExposureScan(op, scan([], "2026-10-14T01:59:00Z"), "c")).rejects.toBeInstanceOf(PortPolicyError);
    await expect(service.importExposureScan(op, scan([{ port: 22, address: "10.1.1.1" }], "2026-10-14T02:30:00Z"), "c")).rejects.toBeInstanceOf(PortPolicyError);
    await expect(service.importExposureScan(op, scan([{ port: 22, address: "198.51.100.1" }], "2026-10-14T02:30:00Z"), "c")).rejects.toBeInstanceOf(PortPolicyError);
  });
});

describe("exceptions", () => {
  const base = { family: "EXTERNAL_EXPOSURE" as const, address: "203.0.113.10", port: 443, protocol: "TCP" as const, reason: "Website", owner: "IT" };

  it("must expire within the policy limit and only an administrator approves them", async () => {
    await expect(service.addException(admin, { ...base, expiresAt: new Date("2027-12-01T00:00:00Z") }, "c")).rejects.toBeInstanceOf(PortPolicyError);
    await expect(service.addException(admin, { ...base, expiresAt: new Date("2026-10-01T00:00:00Z") }, "c")).rejects.toBeInstanceOf(PortPolicyError);
    await expect(service.addException(op, { ...base, expiresAt: new Date("2026-12-01T00:00:00Z") }, "c")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("can be revoked, which ends the approval", async () => {
    await service.importExposureScan(op, scan([{ port: 443 }]), "c");
    const ex = await service.addException(admin, { ...base, expiresAt: new Date("2026-12-01T00:00:00Z") }, "c");
    await service.revokeException(admin, ex.id, "c");
    const snap = await service.getSnapshot(op);
    expect(snap.exposures[0]!.classification).toBe("UNAPPROVED");
    expect(snap.exceptions[0]!.state).toBe("revoked");
  });
});

describe("restricted egress", () => {
  const egressAlert = {
    wazuhAlertId: "w1", ruleId: 100160, ruleLevel: 10, category: "restricted_egress" as const,
    description: "Sophos: outbound connection allowed to restricted port 3389/TCP", sourceName: "sophos-firewall",
    detectedAt: now, investigationUrl: "https://wazuh/x",
  };

  it("summarises egress events by port and honours egress exceptions only", async () => {
    store.egress.push({ ...egressAlert, detectedAt: now }, { ...egressAlert, wazuhAlertId: "w2", detectedAt: now });
    let snap = await service.getSnapshot(op);
    expect(snap.egress).toMatchObject([{ port: 3389, classification: "UNAPPROVED", severity: "P2", events: 2 }]);
    expect(await service.isEgressExcepted(egressAlert)).toBe(false);

    await service.addException(admin, { family: "RESTRICTED_EGRESS", address: null, port: 3389, protocol: "TCP", reason: "Vendor remote support", owner: "IT", expiresAt: new Date("2026-11-01T00:00:00Z") }, "c");
    snap = await service.getSnapshot(op);
    expect(snap.egress[0]!.classification).toBe("APPROVED");
    expect(await service.isEgressExcepted(egressAlert)).toBe(true);
  });

  it("denies the Executive Viewer", async () => {
    await expect(service.getSnapshot(exec)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
