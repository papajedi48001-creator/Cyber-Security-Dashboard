// Cloudflare Free WAF as sampled events (spec "Cloudflare Free WAF"): trend,
// actions, top paths, countries and sources. Always labelled sampled; a failed
// or old fetch is shown as such, never as zero.

import type { AuditLog } from "../audit";
import { requirePermission, type Principal } from "../auth/authorize";
import { safeError } from "../notifications/delivery";
import type { RawWafSummary, WafSource } from "./client";

export const WAF_WINDOW_HOURS = 24;
export const WAF_STALE_MINUTES = 60;

export interface WafSnapshot {
  fetchedAt: Date;
  since: Date;
  until: Date;
  summary: RawWafSummary;
}

export interface WafStore {
  latest(): Promise<WafSnapshot | null>;
  save(snapshot: WafSnapshot): Promise<void>;
  /** Connector attempt bookkeeping (shared ConnectorState). */
  recordAttempt(at: Date, error: string | null): Promise<void>;
  lastAttempt(): Promise<{ at: Date | null; error: string | null }>;
}

export interface SampledWafSummary {
  sampled: true;
  status: "fresh" | "stale" | "error" | "unavailable";
  reason: string;
  fetchedAt: Date | null;
  range: { since: Date; until: Date } | null;
  lastError: string | null;
  total: number | null;
  actions: { action: string; count: number }[];
  topPaths: { path: string; count: number }[];
  countries: { country: string; count: number }[];
  sources: { source: string; count: number }[];
  trend: { hour: string; count: number }[];
}

/** Masks long numbers, UUIDs and tokens so paths cannot carry identifiers. */
export function redactPath(path: string): string {
  return path
    .slice(0, 200)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "*")
    .replace(/\d{6,}/g, "*")
    .replace(/[A-Za-z0-9_-]{32,}/g, "*");
}

export function createWafService({
  source,
  store,
  audit,
  clock = () => new Date(),
}: {
  source: WafSource | null;
  store: WafStore;
  audit: AuditLog;
  clock?: () => Date;
}) {
  async function summary(): Promise<SampledWafSummary> {
    const now = clock();
    const [snapshot, attempt] = await Promise.all([store.latest(), store.lastAttempt()]);
    const empty = { actions: [], topPaths: [], countries: [], sources: [], trend: [] };
    if (!snapshot)
      return {
        sampled: true,
        status: "unavailable",
        reason: source ? "ยังดึงข้อมูลจาก Cloudflare ไม่สำเร็จ จึงยังไม่ทราบจำนวนเหตุการณ์" : "ยังไม่ได้ตั้งค่าการเชื่อมต่อ Cloudflare",
        fetchedAt: null,
        range: null,
        lastError: attempt.error,
        total: null,
        ...empty,
      };
    const ageMinutes = Math.floor((now.getTime() - snapshot.fetchedAt.getTime()) / 60_000);
    // A successful fetch clears the error, so any recorded error means the latest attempt failed.
    const failedSince = Boolean(attempt.error);
    const status = failedSince ? "error" : ageMinutes > WAF_STALE_MINUTES ? "stale" : "fresh";
    const reason =
      status === "error"
        ? `ดึงข้อมูลล่าสุดไม่สำเร็จ แสดงข้อมูลเมื่อ ${ageMinutes} นาทีก่อน`
        : status === "stale"
          ? `ข้อมูลไม่เป็นปัจจุบัน (ดึงล่าสุด ${ageMinutes} นาทีก่อน)`
          : "ข้อมูลเป็นปัจจุบัน";
    const s = snapshot.summary;
    return {
      sampled: true,
      status,
      reason,
      fetchedAt: snapshot.fetchedAt,
      range: { since: snapshot.since, until: snapshot.until },
      lastError: attempt.error,
      total: s.total,
      actions: s.byAction.map((g) => ({ action: g.dimensions.action, count: g.count })),
      topPaths: s.byPath.map((g) => ({ path: redactPath(g.dimensions.clientRequestPath), count: g.count })),
      countries: s.byCountry.map((g) => ({ country: g.dimensions.clientCountryName, count: g.count })),
      sources: s.bySource.map((g) => ({ source: g.dimensions.source, count: g.count })),
      trend: s.trend.map((g) => ({ hour: g.dimensions.datetimeHour, count: g.count })),
    };
  }

  return {
    configured: source !== null,

    /** Worker: fetch the last 24 hours of sampled events. */
    async refresh(correlationId: string) {
      if (!source) return { status: "unconfigured" as const };
      const until = clock();
      const since = new Date(until.getTime() - WAF_WINDOW_HOURS * 3_600_000);
      try {
        const fetched = await source.fetchSummary({ since, until });
        await store.save({ fetchedAt: until, since, until, summary: fetched });
        await store.recordAttempt(until, null);
        return { status: "ok" as const, total: fetched.total };
      } catch (error) {
        const message = safeError(error);
        const previous = await store.lastAttempt();
        await store.recordAttempt(until, message);
        if (!previous.error)
          await audit.append({
            actor: { id: null, label: "system:cloudflare" },
            action: "connector.failed",
            target: { type: "Connector", id: "cloudflare" },
            metadata: { error: message },
            correlationId,
          });
        return { status: "error" as const, error: message };
      }
    },

    /** Counts only, for the executive summary. */
    async executiveWafStatus(actor: Principal) {
      requirePermission(actor, "executive.read");
      const current = await summary();
      return { status: current.status, total: current.total, blocked: current.actions.find((a) => a.action === "block")?.count ?? null };
    },

    async getSampledWafSummary(actor: Principal): Promise<SampledWafSummary> {
      requirePermission(actor, "evidence.read");
      return summary();
    },
  };
}

export type WafService = ReturnType<typeof createWafService>;

/** Test and development store. */
export class InMemoryWafStore implements WafStore {
  snapshots: WafSnapshot[] = [];
  attempt: { at: Date | null; error: string | null } = { at: null, error: null };

  async latest() {
    return this.snapshots.at(-1) ?? null;
  }
  async save(snapshot: WafSnapshot) {
    this.snapshots.push(snapshot);
  }
  async recordAttempt(at: Date, error: string | null) {
    this.attempt = { at, error };
  }
  async lastAttempt() {
    return this.attempt;
  }
}
