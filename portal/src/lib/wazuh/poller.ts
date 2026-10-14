import type { AuditLog } from "../audit";
import type { WazuhAlertSource } from "./client";
import { MalformedAlertError, normalizeWazuhAlert, type IndexerHit, type NormalizedAlert } from "./normalize-alert";

export const CONNECTOR_NAME = "wazuh-indexer";
/** Each poll re-reads this window before the checkpoint so late-indexed alerts are not missed. */
export const OVERLAP_MS = 2 * 60_000;
const INITIAL_LOOKBACK_MS = 60 * 60_000;
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGES_PER_POLL = 20;

export interface ConnectorSnapshot {
  checkpoint: string | null;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
}

export interface IntakeStore {
  getConnector(name: string): Promise<ConnectorSnapshot>;
  saveConnector(name: string, patch: Partial<ConnectorSnapshot>): Promise<void>;
  /** Inserts new references and bumps deliveryCount/lastSeenAt for known ones, atomically. */
  upsertAlerts(alerts: NormalizedAlert[], now: Date): Promise<{ created: NormalizedAlert[]; duplicates: number }>;
  /** Moves each source's lastEventAt forward (never backward). */
  recordSourceActivity(activity: Map<string, Date>): Promise<void>;
}

export interface PollResult {
  status: "ok" | "error";
  fetched: number;
  created: number;
  duplicates: number;
  malformed: number;
  newAlerts: NormalizedAlert[];
  error?: string;
}

export async function pollWazuhAlerts(deps: {
  source: WazuhAlertSource;
  store: IntakeStore;
  audit: AuditLog;
  dashboardUrl: string;
  clock?: () => Date;
  pageSize?: number;
}): Promise<PollResult> {
  const now = (deps.clock ?? (() => new Date()))();
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const connector = await deps.store.getConnector(CONNECTOR_NAME);
  const checkpoint = connector.checkpoint ? new Date(connector.checkpoint) : new Date(now.getTime() - INITIAL_LOOKBACK_MS);
  const since = new Date(checkpoint.getTime() - (connector.checkpoint ? OVERLAP_MS : 0));

  try {
    const hits: IndexerHit[] = [];
    let searchAfter: unknown[] | undefined;
    for (let page = 0; page < MAX_PAGES_PER_POLL; page++) {
      const batch = await deps.source.searchAlerts({ since, searchAfter, size: pageSize });
      hits.push(...batch);
      if (batch.length < pageSize) break;
      searchAfter = batch[batch.length - 1]?.sort;
      if (!searchAfter) break;
    }

    const alerts: NormalizedAlert[] = [];
    const activity = new Map<string, Date>();
    let malformed = 0;
    let latest = checkpoint;
    const touch = (name: string, at: Date) => {
      const current = activity.get(name);
      if (!current || at > current) activity.set(name, at);
      if (at > latest) latest = at;
    };
    for (const hit of hits) {
      try {
        const result = normalizeWazuhAlert(hit, deps.dashboardUrl);
        if (result.kind === "alert") {
          alerts.push(result.alert);
          touch(result.alert.sourceName, result.alert.detectedAt);
        } else if (result.kind === "heartbeat") {
          touch(result.sourceName, result.at);
        }
      } catch (error) {
        if (!(error instanceof MalformedAlertError)) throw error;
        malformed++;
      }
    }

    const { created, duplicates } = await deps.store.upsertAlerts(alerts, now);
    await deps.store.recordSourceActivity(activity);
    await deps.store.saveConnector(CONNECTOR_NAME, {
      checkpoint: latest.toISOString(),
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastError: malformed ? `${malformed} malformed alert(s) skipped` : null,
    });
    return { status: "ok", fetched: hits.length, created: created.length, duplicates, malformed, newAlerts: created };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "unknown error").slice(0, 300);
    await deps.store.saveConnector(CONNECTOR_NAME, { lastAttemptAt: now, lastError: message });
    await deps.audit.append({
      actor: { id: null, label: "system:wazuh-poller" },
      action: "connector.wazuh_poll_failed",
      target: { type: "Connector", id: CONNECTOR_NAME },
      metadata: { error: message },
      correlationId: `poll-${now.getTime()}`,
    });
    return { status: "error", fetched: 0, created: 0, duplicates: 0, malformed: 0, newAlerts: [], error: message };
  }
}

export class InMemoryIntakeStore implements IntakeStore {
  connector: ConnectorSnapshot = { checkpoint: null, lastAttemptAt: null, lastSuccessAt: null, lastError: null };
  readonly alerts = new Map<string, NormalizedAlert & { deliveryCount: number; lastSeenAt: Date }>();
  readonly sourceActivity = new Map<string, Date>();

  async getConnector() {
    return { ...this.connector };
  }
  async saveConnector(_name: string, patch: Partial<ConnectorSnapshot>) {
    this.connector = { ...this.connector, ...patch };
  }
  async upsertAlerts(alerts: NormalizedAlert[], now: Date) {
    const created: NormalizedAlert[] = [];
    let duplicates = 0;
    for (const alert of alerts) {
      const existing = this.alerts.get(alert.wazuhAlertId);
      if (existing) {
        existing.deliveryCount++;
        existing.lastSeenAt = now;
        duplicates++;
      } else {
        this.alerts.set(alert.wazuhAlertId, { ...alert, deliveryCount: 1, lastSeenAt: now });
        created.push(alert);
      }
    }
    return { created, duplicates };
  }
  async recordSourceActivity(activity: Map<string, Date>) {
    for (const [name, at] of activity) {
      const current = this.sourceActivity.get(name);
      if (!current || at > current) this.sourceActivity.set(name, at);
    }
  }
}
