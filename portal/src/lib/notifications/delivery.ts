// Queues and delivers Notification Summaries over Email and LINE OA. Every
// attempt is audited; failures stay queued with backoff and escalate after
// MAX_ATTEMPTS so they show as open failures in the Portal.

import type { AuditLog } from "../audit";
import { notificationTime, DEFAULT_CALENDAR, type WorkingCalendar } from "../incidents/sla";
import { buildNotificationSummary, renderNotificationText, type NotifiableIncident } from "./payload";

export type ChannelName = "EMAIL" | "LINE";
export type DeliveryStatus = "PENDING" | "SENT" | "FAILED" | "ESCALATED";

export interface NotificationChannel {
  readonly name: ChannelName;
  /** Throws on failure. Error messages must not contain credentials. */
  send(text: string): Promise<void>;
}

export interface DeliveryRow {
  id: string;
  incidentId: string;
  incidentNumber: string;
  channel: ChannelName;
  event: string;
  message: string;
  status: DeliveryStatus;
  attempts: number;
  notBefore: Date;
  nextAttemptAt: Date;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export type NewDelivery = Omit<DeliveryRow, "id" | "status" | "attempts" | "lastError" | "sentAt" | "createdAt">;
export type DeliveryPatch = Partial<Pick<DeliveryRow, "status" | "attempts" | "nextAttemptAt" | "lastError" | "sentAt">>;

export interface DeliveryStore {
  /** Ignores a row whose (incidentId, channel, event) already exists. */
  insertIfAbsent(row: NewDelivery): Promise<boolean>;
  due(now: Date, limit: number): Promise<DeliveryRow[]>;
  update(id: string, patch: DeliveryPatch): Promise<void>;
  openFailures(): Promise<DeliveryRow[]>;
}

export const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
const MAX_ERROR_LENGTH = 200;

/** Keeps a failure message useful without storing tokens or multi-line server output. */
export function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(token|password|secret|key)[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_LENGTH);
}

export function createNotifier({
  store,
  channels,
  audit,
  portalBaseUrl,
  clock = () => new Date(),
  calendar = DEFAULT_CALENDAR,
}: {
  store: DeliveryStore;
  channels: NotificationChannel[];
  audit: AuditLog;
  portalBaseUrl: string;
  clock?: () => Date;
  calendar?: WorkingCalendar;
}) {
  const byName = new Map(channels.map((c) => [c.name, c]));
  const record = (action: string, row: DeliveryRow, correlationId: string, metadata?: Record<string, unknown>) =>
    audit.append({
      actor: { id: null, label: "system:notifications" },
      action,
      target: { type: "Incident", id: row.incidentId },
      metadata: { number: row.incidentNumber, channel: row.channel, event: row.event, ...metadata },
      correlationId,
    });

  return {
    channelsConfigured: channels.map((c) => c.name),

    /** P1/P2 are due immediately; P3/P4 at the next working time. */
    async enqueue(incident: NotifiableIncident, event: string, _correlationId: string) {
      const now = clock();
      const due = notificationTime(incident.severity, now, calendar);
      const message = renderNotificationText(buildNotificationSummary(incident, portalBaseUrl));
      for (const channel of channels) {
        await store.insertIfAbsent({
          incidentId: incident.id,
          incidentNumber: incident.number,
          channel: channel.name,
          event,
          message,
          notBefore: due,
          nextAttemptAt: due,
        });
      }
    },

    async dispatchDue(correlationId: string, limit = 50) {
      const now = clock();
      let sent = 0;
      let failed = 0;
      for (const row of await store.due(now, limit)) {
        const channel = byName.get(row.channel);
        const attempts = row.attempts + 1;
        try {
          if (!channel) throw new Error(`ช่องทาง ${row.channel} ไม่ได้ตั้งค่า`);
          await channel.send(row.message);
          await store.update(row.id, { status: "SENT", attempts, sentAt: now, lastError: null });
          await record("notification.sent", row, correlationId, { attempts });
          sent++;
        } catch (error) {
          const lastError = safeError(error);
          const final = attempts >= MAX_ATTEMPTS;
          const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
          await store.update(row.id, {
            status: final ? "ESCALATED" : "FAILED",
            attempts,
            lastError,
            nextAttemptAt: new Date(now.getTime() + backoff),
          });
          await record(final ? "notification.escalated" : "notification.failed", row, correlationId, { attempts, error: lastError });
          failed++;
        }
      }
      return { sent, failed };
    },

    openFailures() {
      return store.openFailures();
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;

/** Test and development store. */
export class InMemoryDeliveryStore implements DeliveryStore {
  readonly rows: DeliveryRow[] = [];

  async insertIfAbsent(row: NewDelivery) {
    if (this.rows.some((r) => r.incidentId === row.incidentId && r.channel === row.channel && r.event === row.event)) return false;
    this.rows.push({
      ...row,
      id: `nd-${this.rows.length + 1}`,
      status: "PENDING",
      attempts: 0,
      lastError: null,
      sentAt: null,
      createdAt: new Date(),
    });
    return true;
  }
  async due(now: Date, limit: number) {
    return this.rows
      .filter((r) => (r.status === "PENDING" || r.status === "FAILED") && r.nextAttemptAt <= now)
      .slice(0, limit);
  }
  async update(id: string, patch: DeliveryPatch) {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, patch);
  }
  async openFailures() {
    return this.rows.filter((r) => r.status === "FAILED" || r.status === "ESCALATED");
  }
}
