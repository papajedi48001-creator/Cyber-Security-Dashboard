// Incident lifecycle (spec "Incident Workflow"): numbering, SLA targets, owner
// acknowledgement, P1/P2 closure review by a separate person, and one audit
// record plus one timeline entry for every mutation.

import type { AuditLog } from "../audit";
import { requirePermission, type Principal, type Role } from "../auth/authorize";
import { suggestedSeverity, type NormalizedAlert, type Severity } from "../wazuh/normalize-alert";
import { acknowledgeDue } from "./sla";

export type IncidentStatus =
  | "NEW"
  | "ASSIGNED"
  | "ACKNOWLEDGED"
  | "INVESTIGATING"
  | "MITIGATED"
  | "PENDING_REVIEW"
  | "CLOSED";

export interface Incident {
  id: string;
  number: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  category: string | null;
  sourceName: string | null;
  assetId: string | null;
  ownerId: string | null;
  detectedAt: Date;
  acknowledgeDue: Date;
  acknowledgedAt: Date | null;
  mitigatedAt: Date | null;
  closedAt: Date | null;
  cause: string | null;
  remediation: string | null;
  closedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimelineEntry {
  id: string;
  incidentId: string;
  at: Date;
  actorId: string | null;
  type: string;
  note: string | null;
}

export interface ClosureEvidence {
  id: string;
  incidentId: string;
  submittedById: string;
  submittedAt: Date;
  summary: string;
  reference: string;
  reviewedById: string | null;
  reviewedAt: Date | null;
  decision: "APPROVED" | "REJECTED" | null;
  reviewNote: string | null;
}

export type LinkedAlert = NormalizedAlert & { incidentId: string | null };

export type NewIncident = Omit<Incident, "id" | "number" | "createdAt" | "updatedAt">;
export type IncidentPatch = Partial<Omit<Incident, "id" | "number" | "createdAt" | "updatedAt">>;
export type NewTimelineEntry = Omit<TimelineEntry, "id" | "incidentId">;

export interface IncidentFilter {
  view?: "open" | "closed" | "all";
  severity?: Severity;
  ownerId?: string;
}

export interface IncidentStore {
  /** Assigns the next INC-YYYY-NNNN number for `year` and writes the first timeline entry atomically. */
  create(data: NewIncident, year: number, entry: NewTimelineEntry): Promise<Incident>;
  findById(id: string): Promise<Incident | null>;
  list(filter: IncidentFilter): Promise<Incident[]>;
  /**
   * Applies the patch only while the incident is still in `expected` status and
   * writes the timeline entry in the same transaction. Returns null when another
   * change won the race.
   */
  applyChange(id: string, expected: IncidentStatus, patch: IncidentPatch, entry: NewTimelineEntry): Promise<Incident | null>;
  addTimeline(incidentId: string, entry: NewTimelineEntry): Promise<void>;
  listTimeline(incidentId: string): Promise<TimelineEntry[]>;
  /** Most recent active incident (New..Investigating) for this category and source. */
  findActiveGroup(category: string, sourceName: string): Promise<Incident | null>;
  findAlert(wazuhAlertId: string): Promise<LinkedAlert | null>;
  linkAlerts(incidentId: string, wazuhAlertIds: string[]): Promise<void>;
  alerts(incidentId: string): Promise<LinkedAlert[]>;
  addEvidence(data: Omit<ClosureEvidence, "id" | "reviewedById" | "reviewedAt" | "decision" | "reviewNote">): Promise<ClosureEvidence>;
  latestEvidence(incidentId: string): Promise<ClosureEvidence | null>;
  reviewEvidence(id: string, review: Pick<ClosureEvidence, "reviewedById" | "reviewedAt" | "decision" | "reviewNote">): Promise<void>;
  /** An active user whose role may own incidents, or null. */
  findAssignee(userId: string): Promise<{ id: string; role: Role } | null>;
  listAssignees(): Promise<{ id: string; displayName: string }[]>;
  /** Alert references not linked to any incident, newest first. */
  listSecurityEvents(limit: number): Promise<LinkedAlert[]>;
}

export class IncidentRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentRuleError";
  }
}

type Actor = Principal & { username: string };

const SEVERITIES: readonly Severity[] = ["P1", "P2", "P3", "P4"];
const REVIEW_REQUIRED: ReadonlySet<Severity> = new Set(["P1", "P2"]);
const ACTIVE: ReadonlySet<IncidentStatus> = new Set(["NEW", "ASSIGNED", "ACKNOWLEDGED", "INVESTIGATING"]);
const TRANSITIONS: Partial<Record<IncidentStatus, IncidentStatus[]>> = {
  ACKNOWLEDGED: ["INVESTIGATING"],
  INVESTIGATING: ["MITIGATED"],
  MITIGATED: ["INVESTIGATING"],
};
const OWNER_ROLES: ReadonlySet<Role> = new Set(["SECURITY_ADMINISTRATOR", "SECURITY_OPERATOR"]);
const SYSTEM_ACTOR = { id: null, label: "system:wazuh-intake" } as const;
const NATIONAL_ID = /(?<!\d)\d{13}(?!\d)/;

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  NEW: "ใหม่",
  ASSIGNED: "มอบหมายแล้ว",
  ACKNOWLEDGED: "รับทราบแล้ว",
  INVESTIGATING: "กำลังตรวจสอบ",
  MITIGATED: "ควบคุมได้แล้ว",
  PENDING_REVIEW: "รอตรวจการปิด",
  CLOSED: "ปิดแล้ว",
};

function text(value: string | undefined | null, field: string, max: number): string {
  const cleaned = (value ?? "").trim();
  if (!cleaned) throw new IncidentRuleError(`${field} ต้องไม่ว่าง`);
  if (cleaned.length > max) throw new IncidentRuleError(`${field} ยาวเกิน ${max} ตัวอักษร`);
  if (NATIONAL_ID.test(cleaned)) throw new IncidentRuleError(`${field} ต้องไม่มีข้อมูลส่วนบุคคลหรือข้อมูลผู้ป่วย`);
  return cleaned;
}

function severity(value: string): Severity {
  if (!SEVERITIES.includes(value as Severity)) throw new IncidentRuleError("ระดับความรุนแรงไม่ถูกต้อง");
  return value as Severity;
}

/** Incident numbers follow the hospital's calendar year (Asia/Bangkok). */
const bangkokYear = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).getUTCFullYear();

export function createIncidentService({
  store,
  audit,
  clock = () => new Date(),
}: {
  store: IncidentStore;
  audit: AuditLog;
  clock?: () => Date;
}) {
  const record = (
    actor: { id: string | null; label: string },
    action: string,
    incident: Incident,
    correlationId: string,
    metadata?: Record<string, unknown>,
  ) =>
    audit.append({
      actor,
      action,
      target: { type: "Incident", id: incident.id },
      metadata: { number: incident.number, ...metadata },
      correlationId,
    });
  const who = (actor: Actor) => ({ id: actor.id, label: actor.username });

  async function load(id: string): Promise<Incident> {
    const incident = await store.findById(id);
    if (!incident) throw new IncidentRuleError("ไม่พบ incident");
    return incident;
  }

  async function change(
    incident: Incident,
    patch: IncidentPatch,
    entry: { actorId: string | null; type: string; note?: string | null },
  ): Promise<Incident> {
    const updated = await store.applyChange(incident.id, incident.status, patch, {
      at: clock(),
      actorId: entry.actorId,
      type: entry.type,
      note: entry.note ?? null,
    });
    if (!updated) throw new IncidentRuleError("incident ถูกเปลี่ยนโดยผู้อื่น กรุณาโหลดใหม่");
    return updated;
  }

  function requireOwnerOrAdmin(actor: Actor, incident: Incident) {
    if (incident.ownerId !== actor.id && actor.role !== "SECURITY_ADMINISTRATOR")
      throw new IncidentRuleError("เฉพาะผู้รับผิดชอบ incident หรือ Security Administrator");
  }

  async function open(
    actor: { id: string | null; label: string },
    input: { title: string; severity: Severity; detectedAt: Date; category?: string | null; sourceName?: string | null },
    correlationId: string,
    metadata?: Record<string, unknown>,
  ): Promise<Incident> {
    const now = clock();
    const incident = await store.create(
      {
        title: text(input.title, "หัวข้อ", 255),
        severity: severity(input.severity),
        status: "NEW",
        category: input.category ?? null,
        sourceName: input.sourceName ?? null,
        assetId: null,
        ownerId: null,
        detectedAt: input.detectedAt,
        acknowledgeDue: acknowledgeDue(input.severity, input.detectedAt),
        acknowledgedAt: null,
        mitigatedAt: null,
        closedAt: null,
        cause: null,
        remediation: null,
        closedById: null,
      },
      bangkokYear(now),
      { at: now, actorId: actor.id, type: "created", note: null },
    );
    await record(actor, "incident.created", incident, correlationId, { severity: incident.severity, ...metadata });
    return incident;
  }

  return {
    async listIncidents(actor: Principal, filter: IncidentFilter) {
      requirePermission(actor, "incident.read");
      return store.list(filter);
    },

    async getIncident(actor: Principal, id: string) {
      requirePermission(actor, "incident.read");
      return load(id);
    },

    async getIncidentDetail(actor: Principal, id: string) {
      requirePermission(actor, "incident.read");
      const incident = await load(id);
      const [timeline, alerts, evidence] = await Promise.all([
        store.listTimeline(id),
        store.alerts(id),
        store.latestEvidence(id),
      ]);
      return { incident, timeline, alerts, evidence };
    },

    async listAssignees(actor: Principal) {
      requirePermission(actor, "incident.read");
      return store.listAssignees();
    },

    async listSecurityEvents(actor: Principal, limit = 100) {
      requirePermission(actor, "incident.read");
      return store.listSecurityEvents(limit);
    },

    async createIncident(
      actor: Actor,
      input: { title: string; severity: Severity; detectedAt: Date },
      correlationId: string,
    ) {
      requirePermission(actor, "incident.write");
      if (input.detectedAt > clock()) throw new IncidentRuleError("เวลาที่ตรวจพบต้องไม่อยู่ในอนาคต");
      return open(who(actor), input, correlationId);
    },

    async assignIncident(actor: Actor, id: string, ownerId: string, correlationId: string) {
      requirePermission(actor, "incident.write");
      const incident = await load(id);
      if (incident.status === "CLOSED" || incident.status === "PENDING_REVIEW")
        throw new IncidentRuleError("มอบหมาย incident ที่ปิดหรือรอตรวจแล้วไม่ได้");
      const owner = await store.findAssignee(ownerId);
      if (!owner || !OWNER_ROLES.has(owner.role)) throw new IncidentRuleError("ผู้รับผิดชอบต้องเป็น Security Operator หรือ Administrator ที่ใช้งานอยู่");
      if (incident.ownerId === ownerId) throw new IncidentRuleError("incident นี้มอบหมายให้ผู้ใช้นี้อยู่แล้ว");
      const updated = await change(
        incident,
        { ownerId, status: incident.status === "NEW" ? "ASSIGNED" : incident.status },
        { actorId: actor.id, type: "assigned" },
      );
      await record(who(actor), "incident.assigned", updated, correlationId, { ownerId, previousOwnerId: incident.ownerId });
      return updated;
    },

    async acknowledgeIncident(actor: Actor, id: string, correlationId: string) {
      requirePermission(actor, "incident.write");
      const incident = await load(id);
      if (incident.status !== "ASSIGNED") throw new IncidentRuleError("รับทราบได้เฉพาะ incident ที่มอบหมายแล้ว");
      if (incident.ownerId !== actor.id) throw new IncidentRuleError("เฉพาะผู้รับผิดชอบเท่านั้นที่รับทราบได้");
      const updated = await change(
        incident,
        { status: "ACKNOWLEDGED", acknowledgedAt: clock() },
        { actorId: actor.id, type: "acknowledged" },
      );
      await record(who(actor), "incident.acknowledged", updated, correlationId);
      return updated;
    },

    async transitionIncident(actor: Actor, id: string, to: IncidentStatus, correlationId: string) {
      requirePermission(actor, "incident.write");
      const incident = await load(id);
      if (!TRANSITIONS[incident.status]?.includes(to))
        throw new IncidentRuleError(`เปลี่ยนสถานะจาก ${STATUS_LABELS[incident.status]} เป็น ${STATUS_LABELS[to] ?? to} ไม่ได้`);
      requireOwnerOrAdmin(actor, incident);
      const patch: IncidentPatch = { status: to };
      if (to === "MITIGATED") patch.mitigatedAt = clock();
      const updated = await change(incident, patch, { actorId: actor.id, type: "status_changed", note: `${incident.status} → ${to}` });
      await record(who(actor), "incident.status_changed", updated, correlationId, { from: incident.status, to });
      return updated;
    },

    async changeSeverity(actor: Actor, id: string, to: Severity, reason: string, correlationId: string) {
      requirePermission(actor, "incident.write");
      const incident = await load(id);
      const next = severity(to);
      const why = text(reason, "เหตุผล", 500);
      if (incident.status === "CLOSED" || incident.status === "PENDING_REVIEW")
        throw new IncidentRuleError("เปลี่ยนระดับของ incident ที่ปิดหรือรอตรวจแล้วไม่ได้");
      if (next === incident.severity) throw new IncidentRuleError("ระดับความรุนแรงเท่าเดิม");
      // Stops an owner from skipping the P1/P2 closure review by downgrading.
      if (REVIEW_REQUIRED.has(incident.severity) && !REVIEW_REQUIRED.has(next) && incident.ownerId === actor.id)
        throw new IncidentRuleError("ผู้รับผิดชอบลดระดับ P1/P2 เองไม่ได้ ต้องให้ผู้อื่นดำเนินการ");
      const updated = await change(
        incident,
        { severity: next, acknowledgeDue: acknowledgeDue(next, incident.detectedAt) },
        { actorId: actor.id, type: "severity_changed", note: `${incident.severity} → ${next}: ${why}` },
      );
      await record(who(actor), "incident.severity_changed", updated, correlationId, { from: incident.severity, to: next, reason: why });
      return updated;
    },

    async closeIncident(actor: Actor, id: string, input: { cause: string; remediation: string }, correlationId: string) {
      requirePermission(actor, "incident.write");
      const incident = await load(id);
      if (REVIEW_REQUIRED.has(incident.severity))
        throw new IncidentRuleError("P1/P2 ต้องส่ง Closure Evidence ให้ผู้อื่นตรวจก่อนปิด");
      if (incident.status !== "MITIGATED") throw new IncidentRuleError("ปิดได้เฉพาะ incident ที่ควบคุมได้แล้ว");
      const cause = text(input.cause, "สาเหตุ", 5000);
      const remediation = text(input.remediation, "การแก้ไข", 5000);
      const updated = await change(
        incident,
        { status: "CLOSED", cause, remediation, closedAt: clock(), closedById: actor.id },
        { actorId: actor.id, type: "closed" },
      );
      await record(who(actor), "incident.closed", updated, correlationId);
      return updated;
    },

    async submitClosureEvidence(
      actor: Actor,
      id: string,
      input: { cause: string; remediation: string; summary: string; reference: string },
      correlationId: string,
    ) {
      requirePermission(actor, "incident.write");
      const incident = await load(id);
      if (!REVIEW_REQUIRED.has(incident.severity)) throw new IncidentRuleError("Closure Evidence ใช้กับ P1/P2 เท่านั้น");
      if (incident.status !== "MITIGATED") throw new IncidentRuleError("ส่งได้เฉพาะ incident ที่ควบคุมได้แล้ว");
      const cause = text(input.cause, "สาเหตุ", 5000);
      const remediation = text(input.remediation, "การแก้ไข", 5000);
      const summary = text(input.summary, "สรุปหลักฐาน", 5000);
      const reference = text(input.reference, "อ้างอิงหลักฐาน", 500);
      const updated = await change(
        incident,
        { status: "PENDING_REVIEW", cause, remediation },
        { actorId: actor.id, type: "closure_submitted", note: reference },
      );
      await store.addEvidence({ incidentId: id, submittedById: actor.id, submittedAt: clock(), summary, reference });
      await record(who(actor), "incident.closure_submitted", updated, correlationId);
      return updated;
    },

    async reviewClosure(actor: Actor, id: string, input: { approve: boolean; note: string }, correlationId: string) {
      requirePermission(actor, "incident.review");
      const incident = await load(id);
      if (incident.status !== "PENDING_REVIEW") throw new IncidentRuleError("incident นี้ไม่ได้รอตรวจการปิด");
      const evidence = await store.latestEvidence(id);
      if (!evidence) throw new IncidentRuleError("ไม่พบ Closure Evidence");
      if (actor.id === evidence.submittedById || actor.id === incident.ownerId)
        throw new IncidentRuleError("ผู้ตรวจต้องไม่ใช่ผู้รับผิดชอบหรือผู้ส่งหลักฐาน");
      const now = clock();
      if (input.approve) {
        const note = (input.note ?? "").trim() ? text(input.note, "บันทึกการตรวจ", 2000) : null;
        const updated = await change(
          incident,
          { status: "CLOSED", closedAt: now, closedById: actor.id },
          { actorId: actor.id, type: "closure_approved", note },
        );
        await store.reviewEvidence(evidence.id, { reviewedById: actor.id, reviewedAt: now, decision: "APPROVED", reviewNote: note });
        await record(who(actor), "incident.closure_approved", updated, correlationId);
        return updated;
      }
      const note = text(input.note, "เหตุผลที่ส่งกลับ", 2000);
      const updated = await change(incident, { status: "INVESTIGATING" }, { actorId: actor.id, type: "closure_rejected", note });
      await store.reviewEvidence(evidence.id, { reviewedById: actor.id, reviewedAt: now, decision: "REJECTED", reviewNote: note });
      await record(who(actor), "incident.closure_rejected", updated, correlationId);
      return updated;
    },

    /**
     * Wazuh intake: alerts at P1/P2 level open incidents automatically; repeats of
     * the same category and source join the active incident. Lower levels stay as
     * Security Events for an operator to promote. Returns newly opened incidents.
     */
    async raiseFromAlerts(alerts: NormalizedAlert[], correlationId: string): Promise<Incident[]> {
      const raised: Incident[] = [];
      const linked = new Map<string, { incident: Incident; alertIds: string[] }>();
      for (const alert of alerts) {
        const level = suggestedSeverity(alert.ruleLevel);
        if (!REVIEW_REQUIRED.has(level)) continue;
        const known = await store.findAlert(alert.wazuhAlertId);
        if (known?.incidentId) continue;
        const group = [...linked.values()].find(
          (g) => g.incident.category === alert.category && g.incident.sourceName === alert.sourceName,
        );
        if (group) {
          group.alertIds.push(alert.wazuhAlertId);
          continue;
        }
        const active = await store.findActiveGroup(alert.category, alert.sourceName);
        if (active) {
          linked.set(active.id, { incident: active, alertIds: [alert.wazuhAlertId] });
          continue;
        }
        const incident = await open(
          SYSTEM_ACTOR,
          { title: alert.description, severity: level, detectedAt: alert.detectedAt, category: alert.category, sourceName: alert.sourceName },
          correlationId,
          { wazuhAlertId: alert.wazuhAlertId, ruleId: alert.ruleId },
        );
        await store.linkAlerts(incident.id, [alert.wazuhAlertId]);
        raised.push(incident);
        linked.set(incident.id, { incident, alertIds: [] });
      }
      for (const { incident, alertIds } of linked.values()) {
        if (alertIds.length === 0) continue;
        await store.linkAlerts(incident.id, alertIds);
        await store.addTimeline(incident.id, {
          at: clock(),
          actorId: null,
          type: "alerts_linked",
          note: `${alertIds.length} alert`,
        });
        await record(SYSTEM_ACTOR, "incident.alerts_linked", incident, correlationId, { count: alertIds.length });
      }
      return raised;
    },

    async promoteAlert(actor: Actor, wazuhAlertId: string, level: Severity, correlationId: string) {
      requirePermission(actor, "incident.write");
      const alert = await store.findAlert(wazuhAlertId);
      if (!alert) throw new IncidentRuleError("ไม่พบ Security Event");
      if (alert.incidentId) throw new IncidentRuleError("Security Event นี้อยู่ใน incident แล้ว");
      const incident = await open(
        who(actor),
        { title: alert.description, severity: level, detectedAt: alert.detectedAt, category: alert.category, sourceName: alert.sourceName },
        correlationId,
        { wazuhAlertId },
      );
      await store.linkAlerts(incident.id, [wazuhAlertId]);
      return incident;
    },
  };
}

export type IncidentService = ReturnType<typeof createIncidentService>;

/** Test and development store. */
export class InMemoryIncidentStore implements IncidentStore {
  readonly incidents = new Map<string, Incident>();
  readonly timeline: TimelineEntry[] = [];
  readonly links = new Map<string, string>();
  readonly alertRefs = new Map<string, LinkedAlert>();
  readonly evidence: ClosureEvidence[] = [];
  /** When null, any id is accepted as an active Security Operator. */
  assignees: Map<string, Role> | null = null;

  async create(data: NewIncident, year: number, entry: NewTimelineEntry) {
    const prefix = `INC-${year}-`;
    const seq = [...this.incidents.values()].filter((i) => i.number.startsWith(prefix)).length + 1;
    const now = new Date();
    const incident: Incident = {
      ...data,
      id: `inc-${this.incidents.size + 1}`,
      number: `${prefix}${String(seq).padStart(4, "0")}`,
      createdAt: now,
      updatedAt: now,
    };
    this.incidents.set(incident.id, incident);
    await this.addTimeline(incident.id, entry);
    return incident;
  }
  async findById(id: string) {
    return this.incidents.get(id) ?? null;
  }
  async list(filter: IncidentFilter) {
    return [...this.incidents.values()]
      .filter((i) => (filter.view === "closed" ? i.status === "CLOSED" : filter.view === "all" || i.status !== "CLOSED"))
      .filter((i) => !filter.severity || i.severity === filter.severity)
      .filter((i) => !filter.ownerId || i.ownerId === filter.ownerId)
      .sort((a, b) => a.severity.localeCompare(b.severity) || b.detectedAt.getTime() - a.detectedAt.getTime());
  }
  async applyChange(id: string, expected: IncidentStatus, patch: IncidentPatch, entry: NewTimelineEntry) {
    const current = this.incidents.get(id);
    if (!current || current.status !== expected) return null;
    const next = { ...current, ...patch, updatedAt: new Date() };
    this.incidents.set(id, next);
    await this.addTimeline(id, entry);
    return next;
  }
  async addTimeline(incidentId: string, entry: NewTimelineEntry) {
    this.timeline.push({ ...entry, id: `tl-${this.timeline.length + 1}`, incidentId });
  }
  async listTimeline(incidentId: string) {
    return this.timeline.filter((t) => t.incidentId === incidentId);
  }
  async findActiveGroup(category: string, sourceName: string) {
    return (
      [...this.incidents.values()]
        .filter((i) => i.category === category && i.sourceName === sourceName && ACTIVE.has(i.status))
        .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())[0] ?? null
    );
  }
  async findAlert(wazuhAlertId: string) {
    const ref = this.alertRefs.get(wazuhAlertId);
    return ref ? { ...ref, incidentId: this.links.get(wazuhAlertId) ?? ref.incidentId } : null;
  }
  async linkAlerts(incidentId: string, wazuhAlertIds: string[]) {
    for (const id of wazuhAlertIds) this.links.set(id, incidentId);
  }
  async alerts(incidentId: string) {
    return [...this.alertRefs.values()]
      .filter((a) => this.links.get(a.wazuhAlertId) === incidentId)
      .map((a) => ({ ...a, incidentId }));
  }
  async addEvidence(data: Omit<ClosureEvidence, "id" | "reviewedById" | "reviewedAt" | "decision" | "reviewNote">) {
    const evidence: ClosureEvidence = {
      ...data,
      id: `ev-${this.evidence.length + 1}`,
      reviewedById: null,
      reviewedAt: null,
      decision: null,
      reviewNote: null,
    };
    this.evidence.push(evidence);
    return evidence;
  }
  async latestEvidence(incidentId: string) {
    return this.evidence.filter((e) => e.incidentId === incidentId).at(-1) ?? null;
  }
  async reviewEvidence(id: string, review: Pick<ClosureEvidence, "reviewedById" | "reviewedAt" | "decision" | "reviewNote">) {
    const index = this.evidence.findIndex((e) => e.id === id);
    if (index >= 0) this.evidence[index] = { ...this.evidence[index]!, ...review };
  }
  async listAssignees() {
    return [...(this.assignees?.keys() ?? [])].map((id) => ({ id, displayName: id }));
  }
  async listSecurityEvents(limit: number) {
    return [...this.alertRefs.values()]
      .filter((a) => !this.links.has(a.wazuhAlertId) && !a.incidentId)
      .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
      .slice(0, limit);
  }
  async findAssignee(userId: string) {
    if (!this.assignees) return { id: userId, role: "SECURITY_OPERATOR" as Role };
    const role = this.assignees.get(userId);
    return role ? { id: userId, role } : null;
  }
}

