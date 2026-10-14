import { describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { buildAlertSearch, createIndexerClient, IndexerError, type WazuhAlertSource } from "./client";
import type { IndexerHit } from "./normalize-alert";
import { InMemoryIntakeStore, pollWazuhAlerts, OVERLAP_MS } from "./poller";

const NOW = new Date("2026-10-14T03:10:00Z");
const DASHBOARD = "https://wazuh.example";

function alert(id: string, minute: number, overrides: Record<string, unknown> = {}): IndexerHit {
  return {
    _id: id,
    _source: {
      timestamp: `2026-10-14T03:0${minute}:00.000Z`,
      rule: { id: "100120", level: 8, description: "Sophos: login failure", groups: ["sophos", "admin_or_login_failure"] },
      decoder: { name: "sophos-sfos" },
      agent: { name: "wazuh" },
      ...overrides,
    },
    sort: [Date.parse(`2026-10-14T03:0${minute}:00.000Z`), id],
  };
}

function source(pages: IndexerHit[][] | Error): WazuhAlertSource & { queries: { since: Date }[] } {
  const queries: { since: Date }[] = [];
  let call = 0;
  return {
    queries,
    async searchAlerts(query) {
      queries.push(query);
      if (pages instanceof Error) throw pages;
      return pages[call++] ?? [];
    },
  };
}

function setup() {
  const store = new InMemoryIntakeStore();
  const auditStore = new InMemoryAuditStore();
  return { store, auditStore, deps: { store, audit: createAuditLog(auditStore, () => NOW), clock: () => NOW, dashboardUrl: DASHBOARD } };
}

describe("pollWazuhAlerts", () => {
  it("stores alert references and advances the checkpoint after a successful write", async () => {
    const { store, deps } = setup();
    const result = await pollWazuhAlerts({ ...deps, source: source([[alert("a1", 1), alert("a2", 2)]]) });
    expect(result).toMatchObject({ status: "ok", created: 2, duplicates: 0, malformed: 0 });
    expect(store.alerts.size).toBe(2);
    expect(store.connector.checkpoint).toBe("2026-10-14T03:02:00.000Z");
    expect(store.connector.lastSuccessAt).toEqual(NOW);
  });

  it("re-reads an overlapping window without creating duplicates", async () => {
    const { store, deps } = setup();
    await pollWazuhAlerts({ ...deps, source: source([[alert("a1", 1)]]) });
    const second = source([[alert("a1", 1), alert("a3", 3)]]);
    const result = await pollWazuhAlerts({ ...deps, source: second });
    expect(result).toMatchObject({ created: 1, duplicates: 1 });
    expect(store.alerts.size).toBe(2);
    expect(store.alerts.get("a1")?.deliveryCount).toBe(2);
    expect(second.queries[0]!.since.getTime()).toBe(Date.parse("2026-10-14T03:01:00.000Z") - OVERLAP_MS);
  });

  it("follows pagination with search_after", async () => {
    const { store, deps } = setup();
    const page1 = Array.from({ length: 3 }, (_, i) => alert(`p${i}`, 1));
    const result = await pollWazuhAlerts({ ...deps, pageSize: 3, source: source([page1, [alert("p3", 2)]]) });
    expect(result.created).toBe(4);
    expect(store.alerts.size).toBe(4);
  });

  it("skips and counts malformed alerts without storing raw payloads", async () => {
    const { store, deps } = setup();
    const bad = alert("bad", 1, { timestamp: "garbage", full_log: "user=secret-user" });
    const result = await pollWazuhAlerts({ ...deps, source: source([[bad, alert("ok", 2)]]) });
    expect(result).toMatchObject({ created: 1, malformed: 1 });
    expect(JSON.stringify([...store.alerts.values()])).not.toContain("secret-user");
  });

  it("updates log source activity from alerts and heartbeats", async () => {
    const { store, deps } = setup();
    const heartbeat = alert("hb", 4, {
      rule: { id: "100183", level: 3, description: "heartbeat", groups: ["log_relay", "log_relay_heartbeat"] },
      decoder: { name: "json" },
    });
    await pollWazuhAlerts({ ...deps, source: source([[alert("a1", 1), heartbeat]]) });
    expect(store.sourceActivity.get("sophos-firewall")).toEqual(new Date("2026-10-14T03:01:00.000Z"));
    expect(store.sourceActivity.get("log-relay")).toEqual(new Date("2026-10-14T03:04:00.000Z"));
    expect(store.alerts.has("hb")).toBe(false);
  });

  it("keeps the checkpoint and records a sanitized error when the Indexer fails", async () => {
    const { store, deps, auditStore } = setup();
    store.connector.checkpoint = "2026-10-14T03:00:00.000Z";
    const result = await pollWazuhAlerts({ ...deps, source: source(new IndexerError("Indexer rejected the service account (HTTP 401)")) });
    expect(result.status).toBe("error");
    expect(store.connector.checkpoint).toBe("2026-10-14T03:00:00.000Z");
    expect(store.connector.lastError).toContain("HTTP 401");
    expect(store.connector.lastSuccessAt).toBeNull();
    expect(auditStore.records.map((r) => r.action)).toContain("connector.wazuh_poll_failed");
  });

  it("returns new alert ids so incidents can be raised for them", async () => {
    const { deps } = setup();
    const result = await pollWazuhAlerts({ ...deps, source: source([[alert("a1", 1)]]) });
    expect(result.newAlerts.map((a) => a.wazuhAlertId)).toEqual(["a1"]);
  });
});

describe("Indexer client", () => {
  it("requests only reference fields and level >= 3 alerts", () => {
    const body = buildAlertSearch({ since: NOW, size: 100 });
    expect(body._source).not.toContain("full_log");
    expect(body._source).not.toContain("data");
    expect(JSON.stringify(body.query)).toContain('"rule.level":{"gte":3}');
  });

  it("never puts the password in an error", async () => {
    const client = createIndexerClient({
      baseUrl: "https://indexer",
      username: "svc-portal",
      password: "pw-should-not-leak",
      transport: async () => ({ status: 401, body: "Unauthorized" }),
    });
    const error = await client.searchAlerts({ since: NOW, size: 10 }).catch((e) => e);
    expect(error).toBeInstanceOf(IndexerError);
    expect(String(error.message)).not.toContain("pw-should-not-leak");
  });

  it("sends basic auth over the configured transport and parses hits", async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    const client = createIndexerClient({
      baseUrl: "https://indexer",
      username: "svc-portal",
      password: "pw",
      transport: async (url, init) => {
        seen = { url, headers: init.headers };
        return { status: 200, body: JSON.stringify({ hits: { hits: [alert("x", 1)] } }) };
      },
    });
    const hits = await client.searchAlerts({ since: NOW, size: 10 });
    expect(hits).toHaveLength(1);
    expect(seen?.url).toBe("https://indexer/wazuh-alerts-*/_search");
    expect(seen?.headers.authorization).toBe(`Basic ${Buffer.from("svc-portal:pw").toString("base64")}`);
  });
});
