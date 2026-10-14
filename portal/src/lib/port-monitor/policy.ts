// Port risk policy (ADR 0007). Exposure comes from the external scan and the
// Sophos NAT/WAN rule export; egress from Wazuh rule 100160. Every exception
// expires, and an expired one never hides a finding.

import type { Severity } from "../wazuh/normalize-alert";

export type PortFamily = "EXTERNAL_EXPOSURE" | "RESTRICTED_EGRESS";
export type Protocol = "TCP" | "UDP";
export type PortClassification = "APPROVED" | "UNAPPROVED" | "EXCEPTION_EXPIRED" | "CONFIGURED_NOT_REACHABLE";

export interface PortException {
  id: string;
  family: PortFamily;
  /** Public address for an exposure; null for egress (any destination). */
  address: string | null;
  port: number;
  protocol: Protocol;
  reason: string;
  owner: string;
  approvedById: string;
  approvedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface PortObservation {
  family: PortFamily;
  address: string | null;
  port: number;
  protocol: Protocol;
  service: string | null;
  seenInScan: boolean;
  inFirewallRules: boolean;
}

export interface PortFinding extends PortObservation {
  classification: PortClassification;
  severity: Severity | null;
  exception: PortException | null;
}

/** Remote administration, file sharing and database ports: P2 when reachable from the Internet. */
export const HIGH_RISK_PORTS: ReadonlySet<number> = new Set([
  21, 22, 23, 135, 137, 138, 139, 445, 1433, 1521, 3306, 3389, 5432, 5900, 6379, 9200, 27017,
]);
/** Must match the dstport list in infrastructure/wazuh/rules/sophos_priority_rules.xml (rule 100160). */
export const RESTRICTED_EGRESS_PORTS: ReadonlySet<number> = new Set([
  21, 22, 23, 135, 137, 138, 139, 445, 1433, 1521, 3306, 3389, 5432, 5900, 6667,
]);
/** The external scan is expected daily; older results are stale. */
export const SCAN_MAX_AGE_HOURS = 36;
export const MAX_EXCEPTION_DAYS = 180;

const covers = (e: PortException, o: PortObservation) =>
  e.family === o.family && e.port === o.port && e.protocol === o.protocol && (e.address === null || e.address === o.address);

export function classifyPortFinding(observation: PortObservation, policy: { exceptions: PortException[]; now: Date }): PortFinding {
  const matching = policy.exceptions.filter((e) => covers(e, observation) && !e.revokedAt);
  const active = matching.find((e) => e.expiresAt > policy.now) ?? null;
  const expired = active ? null : (matching.sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0] ?? null);
  const finding = (classification: PortClassification, severity: Severity | null, exception: PortException | null): PortFinding => ({
    ...observation,
    classification,
    severity,
    exception,
  });

  if (active) return finding("APPROVED", null, active);
  if (observation.family === "RESTRICTED_EGRESS") return finding(expired ? "EXCEPTION_EXPIRED" : "UNAPPROVED", "P2", expired);
  if (!observation.seenInScan) return finding("CONFIGURED_NOT_REACHABLE", "P4", expired);
  const severity: Severity = HIGH_RISK_PORTS.has(observation.port) ? "P2" : "P3";
  return finding(expired ? "EXCEPTION_EXPIRED" : "UNAPPROVED", severity, expired);
}

export function egressPortFromDescription(description: string): { port: number; protocol: Protocol } | null {
  const match = /restricted port (\d{1,5})\/(TCP|UDP)\b/i.exec(description);
  if (!match) return null;
  return { port: Number(match[1]), protocol: match[2]!.toUpperCase() as Protocol };
}

export function scanFreshness(lastScanAt: Date | null, now: Date) {
  if (!lastScanAt) return { status: "missing" as const, reason: "ยังไม่มีผลสแกนจากภายนอก จึงยังไม่ทราบว่ามีพอร์ตเปิดหรือไม่" };
  const hours = Math.floor((now.getTime() - lastScanAt.getTime()) / 3_600_000);
  if (hours > SCAN_MAX_AGE_HOURS)
    return { status: "stale" as const, reason: `ผลสแกนล่าสุดเมื่อ ${hours} ชั่วโมงก่อน (เกณฑ์ ${SCAN_MAX_AGE_HOURS} ชั่วโมง) ข้อมูลอาจไม่เป็นปัจจุบัน` };
  return { status: "fresh" as const, reason: "ผลสแกนเป็นปัจจุบัน" };
}
