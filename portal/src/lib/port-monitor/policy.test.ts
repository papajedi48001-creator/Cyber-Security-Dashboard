import { describe, expect, it } from "vitest";
import { classifyPortFinding, egressPortFromDescription, scanFreshness, type PortException } from "./policy";

const NOW = new Date("2026-10-14T03:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const exception = (overrides: Partial<PortException>): PortException => ({
  id: "x1",
  family: "EXTERNAL_EXPOSURE",
  address: "203.0.113.10",
  port: 443,
  protocol: "TCP",
  reason: "Hospital website",
  owner: "IT",
  approvedById: "admin",
  approvedAt: days(-30),
  expiresAt: days(60),
  revokedAt: null,
  ...overrides,
});

const exposure = (port: number, overrides: Partial<Parameters<typeof classifyPortFinding>[0]> = {}) => ({
  family: "EXTERNAL_EXPOSURE" as const,
  address: "203.0.113.10",
  port,
  protocol: "TCP" as const,
  service: null,
  seenInScan: true,
  inFirewallRules: true,
  ...overrides,
});

describe("classifyPortFinding: External Port Exposure", () => {
  it("approves an exposure covered by an active exception", () => {
    expect(classifyPortFinding(exposure(443), { exceptions: [exception({})], now: NOW })).toMatchObject({
      classification: "APPROVED",
      severity: null,
    });
  });

  it("treats SSH, RDP and database ports seen by the scan as high risk", () => {
    for (const port of [22, 3389, 3306, 1433, 445])
      expect(classifyPortFinding(exposure(port), { exceptions: [], now: NOW })).toMatchObject({ classification: "UNAPPROVED", severity: "P2" });
    expect(classifyPortFinding(exposure(8443), { exceptions: [], now: NOW }).severity).toBe("P3");
  });

  it("never lets an expired or revoked exception hide an exposure", () => {
    const expired = classifyPortFinding(exposure(3389), { exceptions: [exception({ port: 3389, expiresAt: days(-1) })], now: NOW });
    expect(expired).toMatchObject({ classification: "EXCEPTION_EXPIRED", severity: "P2" });
    const revoked = classifyPortFinding(exposure(443), { exceptions: [exception({ revokedAt: days(-1) })], now: NOW });
    expect(revoked).toMatchObject({ classification: "UNAPPROVED", severity: "P3" });
  });

  it("flags a firewall rule that the scan could not reach for review only", () => {
    expect(classifyPortFinding(exposure(3389, { seenInScan: false }), { exceptions: [], now: NOW })).toMatchObject({
      classification: "CONFIGURED_NOT_REACHABLE",
      severity: "P4",
    });
  });

  it("does not let an egress exception approve an exposure", () => {
    const egress = exception({ family: "RESTRICTED_EGRESS", address: null, port: 3389 });
    expect(classifyPortFinding(exposure(3389), { exceptions: [egress], now: NOW }).classification).toBe("UNAPPROVED");
  });
});

describe("classifyPortFinding: Restricted Egress", () => {
  const egress = { family: "RESTRICTED_EGRESS" as const, address: null, port: 3389, protocol: "TCP" as const, service: null, seenInScan: false, inFirewallRules: false };

  it("reports a prohibited outbound port as P2 unless an active exception covers it", () => {
    expect(classifyPortFinding(egress, { exceptions: [], now: NOW })).toMatchObject({ classification: "UNAPPROVED", severity: "P2" });
    const allowed = exception({ family: "RESTRICTED_EGRESS", address: null, port: 3389 });
    expect(classifyPortFinding(egress, { exceptions: [allowed], now: NOW }).classification).toBe("APPROVED");
    expect(classifyPortFinding(egress, { exceptions: [{ ...allowed, expiresAt: days(-1) }], now: NOW }).classification).toBe(
      "EXCEPTION_EXPIRED",
    );
  });

  it("reads the port from the Wazuh rule description", () => {
    expect(egressPortFromDescription("Sophos: outbound connection allowed to restricted port 3389/TCP")).toEqual({ port: 3389, protocol: "TCP" });
    expect(egressPortFromDescription("Sophos: IPS event")).toBeNull();
  });
});

describe("scanFreshness", () => {
  it("reports a missing or old scan as stale, never as no exposure", () => {
    expect(scanFreshness(null, NOW).status).toBe("missing");
    expect(scanFreshness(new Date(NOW.getTime() - 40 * 3_600_000), NOW).status).toBe("stale");
    expect(scanFreshness(new Date(NOW.getTime() - 2 * 3_600_000), NOW).status).toBe("fresh");
  });
});
