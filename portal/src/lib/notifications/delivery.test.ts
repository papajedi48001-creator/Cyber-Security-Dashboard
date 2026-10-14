import { beforeEach, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { createNotifier, InMemoryDeliveryStore, MAX_ATTEMPTS, type NotificationChannel } from "./delivery";

// Tuesday 14 Oct 2026, 23:00 Asia/Bangkok: outside working hours.
const NIGHT = new Date("2026-10-14T16:00:00Z");
const NEXT_MORNING = new Date("2026-10-15T01:30:00Z"); // 08:30 Bangkok

class FakeChannel implements NotificationChannel {
  sent: string[] = [];
  failWith: string | null = null;
  constructor(readonly name: "EMAIL" | "LINE") {}
  async send(text: string) {
    if (this.failWith) throw new Error(this.failWith);
    this.sent.push(text);
  }
}

const incident = (severity: "P1" | "P2" | "P3" | "P4") => ({
  id: `inc-${severity}`,
  number: `INC-2026-000${severity.slice(1)}`,
  severity,
  detectedAt: NIGHT,
  sourceName: "sophos-firewall",
});

let now: Date;
let auditStore: InMemoryAuditStore;
let store: InMemoryDeliveryStore;
let email: FakeChannel;
let line: FakeChannel;
let notifier: ReturnType<typeof createNotifier>;

beforeEach(() => {
  now = NIGHT;
  auditStore = new InMemoryAuditStore();
  store = new InMemoryDeliveryStore();
  email = new FakeChannel("EMAIL");
  line = new FakeChannel("LINE");
  notifier = createNotifier({
    store,
    channels: [email, line],
    audit: createAuditLog(auditStore, () => now),
    portalBaseUrl: "https://portal.hospital.example",
    clock: () => now,
  });
});

describe("scheduling", () => {
  it("sends P1/P2 immediately, any time of day", async () => {
    await notifier.enqueue(incident("P1"), "incident.opened", "c");
    await notifier.dispatchDue("c");
    expect(email.sent).toHaveLength(1);
    expect(line.sent).toHaveLength(1);
    expect(store.rows.every((r) => r.status === "SENT")).toBe(true);
  });

  it("holds P3/P4 until the next working time", async () => {
    await notifier.enqueue(incident("P3"), "incident.opened", "c");
    await notifier.dispatchDue("c");
    expect(email.sent).toHaveLength(0);
    expect(store.rows[0]!.notBefore).toEqual(NEXT_MORNING);
    now = NEXT_MORNING;
    await notifier.dispatchDue("c");
    expect(email.sent).toHaveLength(1);
  });

  it("queues each event once per channel", async () => {
    await notifier.enqueue(incident("P1"), "incident.opened", "c");
    await notifier.enqueue(incident("P1"), "incident.opened", "c");
    expect(store.rows).toHaveLength(2);
  });
});

describe("failures", () => {
  it("audits a failed delivery, keeps it queued and retries with backoff", async () => {
    line.failWith = "LINE HTTP 500";
    await notifier.enqueue(incident("P1"), "incident.opened", "c");
    await notifier.dispatchDue("c");
    const row = store.rows.find((r) => r.channel === "LINE")!;
    expect(row).toMatchObject({ status: "FAILED", attempts: 1, lastError: "LINE HTTP 500" });
    expect(auditStore.records.map((r) => r.action)).toContain("notification.failed");
    expect(email.sent).toHaveLength(1);

    await notifier.dispatchDue("c");
    expect(row.attempts).toBe(1); // backoff not yet elapsed
    line.failWith = null;
    now = new Date(NIGHT.getTime() + 10 * 60_000);
    await notifier.dispatchDue("c");
    expect(store.rows.find((r) => r.channel === "LINE")!.status).toBe("SENT");
  });

  it("escalates after the last attempt and reports it as an open failure", async () => {
    line.failWith = "LINE HTTP 401";
    await notifier.enqueue(incident("P2"), "incident.opened", "c");
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      await notifier.dispatchDue("c");
      now = new Date(now.getTime() + 2 * 60 * 60_000);
    }
    const row = store.rows.find((r) => r.channel === "LINE")!;
    expect(row.status).toBe("ESCALATED");
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(auditStore.records.filter((r) => r.action === "notification.escalated")).toHaveLength(1);
    expect((await notifier.openFailures()).map((f) => f.incidentNumber)).toEqual(["INC-2026-0002"]);
  });

  it("does not leak channel secrets into stored errors", async () => {
    line.failWith = "Bearer abcdefSECRETtoken rejected\n".repeat(30);
    await notifier.enqueue(incident("P1"), "incident.opened", "c");
    await notifier.dispatchDue("c");
    const row = store.rows.find((r) => r.channel === "LINE")!;
    expect(row.lastError).not.toContain("SECRET");
    expect(row.lastError!.length).toBeLessThanOrEqual(200);
  });
});
