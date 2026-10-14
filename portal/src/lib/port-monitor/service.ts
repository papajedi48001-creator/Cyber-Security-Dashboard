// Port Monitor: imports External Exposure Scans and the Sophos WAN/NAT rule
// export, classifies every exposure against expiring exceptions, and reports
// restricted egress seen by Wazuh. Findings become incidents through the worker.

import type { AuditLog } from "../audit";
import { requirePermission, type Principal } from "../auth/authorize";
import type { NormalizedAlert } from "../wazuh/normalize-alert";
import {
  classifyPortFinding,
  egressPortFromDescription,
  MAX_EXCEPTION_DAYS,
  scanFreshness,
  type PortException,
  type PortFamily,
  type PortFinding,
  type Protocol,
} from "./policy";
import { parseExposureScan, parseFirewallExposureRules, ScanImportError, type ExposureScan, type FirewallExposureRule } from "./scan-import";

export interface StoredScan extends ExposureScan {
  id: string;
  importedAt: Date;
}

export interface EgressEvent {
  wazuhAlertId: string;
  detectedAt: Date;
  description: string;
  investigationUrl: string;
}

export interface PortStore {
  saveScan(scan: ExposureScan, importedById: string): Promise<StoredScan>;
  latestScan(): Promise<StoredScan | null>;
  saveFirewallRules(rules: FirewallExposureRule[], importedById: string): Promise<{ id: string; importedAt: Date }>;
  latestFirewallRules(): Promise<{ importedAt: Date; rules: FirewallExposureRule[] } | null>;
  listExceptions(): Promise<PortException[]>;
  addException(exception: Omit<PortException, "id" | "revokedAt">): Promise<PortException>;
  revokeException(id: string, at: Date): Promise<PortException | null>;
  /** Recent restricted_egress alert references. */
  recentEgress(since: Date): Promise<EgressEvent[]>;
}

export class PortPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortPolicyError";
  }
}

type Actor = Principal & { username: string };

const EGRESS_LOOKBACK_MS = 7 * 86_400_000;

export interface ExposureSnapshot {
  scan: { at: Date | null; status: "fresh" | "stale" | "missing"; reason: string; scanner: string | null };
  firewallRulesAt: Date | null;
  exposures: PortFinding[];
  egress: (PortFinding & { events: number; lastSeen: Date; investigationUrl: string })[];
  exceptions: (PortException & { state: "active" | "expired" | "revoked" })[];
}

export function createPortMonitorService({ store, audit, clock = () => new Date() }: { store: PortStore; audit: AuditLog; clock?: () => Date }) {
  const record = (actor: Actor, action: string, target: { type: string; id?: string }, correlationId: string, metadata?: Record<string, unknown>) =>
    audit.append({ actor: { id: actor.id, label: actor.username }, action, target, metadata, correlationId });

  async function snapshot(): Promise<ExposureSnapshot> {
    const now = clock();
    const [scan, firewall, exceptions, egressEvents] = await Promise.all([
      store.latestScan(),
      store.latestFirewallRules(),
      store.listExceptions(),
      store.recentEgress(new Date(now.getTime() - EGRESS_LOOKBACK_MS)),
    ]);
    const policy = { exceptions, now };
    const key = (address: string, port: number, protocol: string) => `${address}|${port}|${protocol}`;
    const observations = new Map<string, Parameters<typeof classifyPortFinding>[0]>();
    for (const f of scan?.findings ?? [])
      observations.set(key(f.address, f.port, f.protocol), {
        family: "EXTERNAL_EXPOSURE", address: f.address, port: f.port, protocol: f.protocol, service: f.service, seenInScan: true, inFirewallRules: false,
      });
    for (const r of firewall?.rules ?? []) {
      const existing = observations.get(key(r.address, r.port, r.protocol));
      // A rule for an address the scan did not cover says nothing about reachability.
      const scanned = scan?.targets.includes(r.address) ?? false;
      if (existing) existing.inFirewallRules = true;
      else if (scanned)
        observations.set(key(r.address, r.port, r.protocol), {
          family: "EXTERNAL_EXPOSURE", address: r.address, port: r.port, protocol: r.protocol, service: r.ruleName, seenInScan: false, inFirewallRules: true,
        });
    }
    const exposures = [...observations.values()]
      .map((o) => classifyPortFinding(o, policy))
      .sort((a, b) => (a.severity ?? "P9").localeCompare(b.severity ?? "P9") || a.port - b.port);

    const egressByPort = new Map<string, { port: number; protocol: Protocol; events: number; lastSeen: Date; investigationUrl: string }>();
    for (const event of egressEvents) {
      const parsed = egressPortFromDescription(event.description);
      if (!parsed) continue;
      const k = `${parsed.port}|${parsed.protocol}`;
      const current = egressByPort.get(k);
      if (!current) egressByPort.set(k, { ...parsed, events: 1, lastSeen: event.detectedAt, investigationUrl: event.investigationUrl });
      else {
        current.events++;
        if (event.detectedAt > current.lastSeen) Object.assign(current, { lastSeen: event.detectedAt, investigationUrl: event.investigationUrl });
      }
    }
    const egress = [...egressByPort.values()].map((e) => ({
      ...classifyPortFinding(
        { family: "RESTRICTED_EGRESS", address: null, port: e.port, protocol: e.protocol, service: null, seenInScan: false, inFirewallRules: false },
        policy,
      ),
      events: e.events,
      lastSeen: e.lastSeen,
      investigationUrl: e.investigationUrl,
    }));

    const freshness = scanFreshness(scan?.finishedAt ?? null, now);
    return {
      scan: { at: scan?.finishedAt ?? null, ...freshness, scanner: scan?.scanner ?? null },
      firewallRulesAt: firewall?.importedAt ?? null,
      exposures,
      egress,
      exceptions: exceptions.map((e) => ({ ...e, state: e.revokedAt ? "revoked" : e.expiresAt > now ? "active" : "expired" })),
    };
  }

  return {
    async getSnapshot(actor: Principal) {
      requirePermission(actor, "evidence.read");
      return snapshot();
    },

    async importExposureScan(actor: Actor, text: string, correlationId: string) {
      requirePermission(actor, "backup.record");
      let scan: ExposureScan;
      try {
        scan = parseExposureScan(text, clock());
      } catch (error) {
        if (error instanceof ScanImportError) throw new PortPolicyError(error.message);
        throw error;
      }
      const latest = await store.latestScan();
      if (latest && scan.finishedAt <= latest.finishedAt) throw new PortPolicyError("ผลสแกนนี้เก่ากว่าหรือซ้ำกับผลล่าสุด");
      const stored = await store.saveScan(scan, actor.id);
      await record(actor, "port.scan_imported", { type: "PortScan", id: stored.id }, correlationId, {
        targets: scan.targets.length,
        openPorts: scan.findings.length,
      });
      return snapshot();
    },

    async importFirewallRules(actor: Actor, csv: string, correlationId: string) {
      requirePermission(actor, "backup.record");
      let rules: FirewallExposureRule[];
      try {
        rules = parseFirewallExposureRules(csv);
      } catch (error) {
        if (error instanceof ScanImportError) throw new PortPolicyError(error.message);
        throw error;
      }
      const saved = await store.saveFirewallRules(rules, actor.id);
      await record(actor, "port.firewall_rules_imported", { type: "FirewallExposureSnapshot", id: saved.id }, correlationId, { rules: rules.length });
    },

    async addException(
      actor: Actor,
      input: { family: PortFamily; address: string | null; port: number; protocol: Protocol; reason: string; owner: string; expiresAt: Date },
      correlationId: string,
    ) {
      requirePermission(actor, "config.manage");
      const now = clock();
      if (input.family !== "EXTERNAL_EXPOSURE" && input.family !== "RESTRICTED_EGRESS") throw new PortPolicyError("ประเภทไม่ถูกต้อง");
      if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new PortPolicyError("port ไม่ถูกต้อง");
      if (input.protocol !== "TCP" && input.protocol !== "UDP") throw new PortPolicyError("protocol ไม่ถูกต้อง");
      const address = input.family === "EXTERNAL_EXPOSURE" ? input.address?.trim() || null : null;
      if (input.family === "EXTERNAL_EXPOSURE" && !address) throw new PortPolicyError("ข้อยกเว้นการเปิดพอร์ตต้องระบุ public address");
      const reason = input.reason.trim();
      const owner = input.owner.trim();
      if (!reason || reason.length > 500 || !owner || owner.length > 128) throw new PortPolicyError("ต้องระบุเหตุผลและผู้รับผิดชอบ");
      if (Number.isNaN(input.expiresAt.getTime()) || input.expiresAt <= now) throw new PortPolicyError("วันหมดอายุต้องอยู่ในอนาคต");
      if (input.expiresAt.getTime() - now.getTime() > MAX_EXCEPTION_DAYS * 86_400_000)
        throw new PortPolicyError(`ข้อยกเว้นมีอายุได้ไม่เกิน ${MAX_EXCEPTION_DAYS} วัน`);
      const created = await store.addException({
        family: input.family, address, port: input.port, protocol: input.protocol, reason, owner,
        approvedById: actor.id, approvedAt: now, expiresAt: input.expiresAt,
      });
      await record(actor, "port.exception_approved", { type: "PortException", id: created.id }, correlationId, {
        family: created.family, port: created.port, protocol: created.protocol, expiresAt: created.expiresAt.toISOString(),
      });
      return created;
    },

    async revokeException(actor: Actor, id: string, correlationId: string) {
      requirePermission(actor, "config.manage");
      const revoked = await store.revokeException(id, clock());
      if (!revoked) throw new PortPolicyError("ไม่พบข้อยกเว้น");
      await record(actor, "port.exception_revoked", { type: "PortException", id }, correlationId);
      return revoked;
    },

    /** Counts only, for the executive summary. */
    async executivePortStatus(actor: Principal) {
      requirePermission(actor, "executive.read");
      const snap = await snapshot();
      const open = snap.exposures.filter((f) => f.classification === "UNAPPROVED" || f.classification === "EXCEPTION_EXPIRED");
      return {
        scanStatus: snap.scan.status,
        unapprovedExposures: open.length,
        highRiskExposures: open.filter((f) => f.severity === "P2").length,
        restrictedEgressPorts: snap.egress.filter((e) => e.classification !== "APPROVED").length,
      };
    },

    /** For the worker: exposures that need an incident (approved ones never do). */
    async findingsForIncidents() {
      const snap = await snapshot();
      return snap.exposures
        .filter((f) => f.severity && f.classification !== "APPROVED")
        .map((f) => ({
          category: "external_exposure",
          sourceName: `${f.address}:${f.port}/${f.protocol}`,
          severity: f.severity!,
          title:
            f.classification === "CONFIGURED_NOT_REACHABLE"
              ? `Firewall เปิด ${f.port}/${f.protocol} ไว้แต่สแกนไม่พบ ควรทบทวน rule`
              : `พอร์ต ${f.port}/${f.protocol} เปิดสู่ Internet${f.classification === "EXCEPTION_EXPIRED" ? " (ข้อยกเว้นหมดอายุ)" : " โดยไม่ได้รับอนุมัติ"}`,
          detectedAt: snap.scan.at ?? clock(),
        }));
    },

    /** For incident intake: an egress alert covered by an active exception stays a Security Event. */
    async isEgressExcepted(alert: NormalizedAlert) {
      if (alert.category !== "restricted_egress") return false;
      const parsed = egressPortFromDescription(alert.description);
      if (!parsed) return false;
      const finding = classifyPortFinding(
        { family: "RESTRICTED_EGRESS", address: null, ...parsed, service: null, seenInScan: false, inFirewallRules: false },
        { exceptions: await store.listExceptions(), now: clock() },
      );
      return finding.classification === "APPROVED";
    },
  };
}

export type PortMonitorService = ReturnType<typeof createPortMonitorService>;

/** Test and development store. */
export class InMemoryPortStore implements PortStore {
  scans: StoredScan[] = [];
  firewall: { id: string; importedAt: Date; rules: FirewallExposureRule[] }[] = [];
  exceptions: PortException[] = [];
  egress: EgressEvent[] = [];

  async saveScan(scan: ExposureScan) {
    const stored = { ...scan, id: `scan-${this.scans.length + 1}`, importedAt: new Date() };
    this.scans.push(stored);
    return stored;
  }
  async latestScan() {
    return [...this.scans].sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime())[0] ?? null;
  }
  async saveFirewallRules(rules: FirewallExposureRule[]) {
    const saved = { id: `fw-${this.firewall.length + 1}`, importedAt: new Date(), rules };
    this.firewall.push(saved);
    return saved;
  }
  async latestFirewallRules() {
    return this.firewall.at(-1) ?? null;
  }
  async listExceptions() {
    return [...this.exceptions];
  }
  async addException(exception: Omit<PortException, "id" | "revokedAt">) {
    const created = { ...exception, id: `px-${this.exceptions.length + 1}`, revokedAt: null };
    this.exceptions.push(created);
    return created;
  }
  async revokeException(id: string, at: Date) {
    const found = this.exceptions.find((e) => e.id === id && !e.revokedAt);
    if (!found) return null;
    found.revokedAt = at;
    return found;
  }
  async recentEgress(since: Date) {
    return this.egress.filter((e) => e.detectedAt >= since);
  }
}
