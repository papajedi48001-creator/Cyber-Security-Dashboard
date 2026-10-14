import { describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { ForbiddenError } from "../auth/authorize";
import { createCloudflareClient } from "./client";
import { createWafService, InMemoryWafStore, redactPath } from "./service";
import type { RawWafSummary } from "./client";

const NOW = new Date("2026-10-14T03:00:00Z");
const op = { id: "op", role: "SECURITY_OPERATOR" as const };
const exec = { id: "exec", role: "EXECUTIVE_VIEWER" as const };

const raw: RawWafSummary = {
  total: 120,
  byAction: [{ count: 100, dimensions: { action: "block" } }, { count: 20, dimensions: { action: "managed_challenge" } }],
  byPath: [{ count: 60, dimensions: { clientRequestPath: "/wp-login.php" } }, { count: 5, dimensions: { clientRequestPath: "/patient/1234567890123/report" } }],
  byCountry: [{ count: 80, dimensions: { clientCountryName: "US" } }],
  bySource: [{ count: 90, dimensions: { source: "firewallManaged" } }],
  trend: [{ count: 70, dimensions: { datetimeHour: "2026-10-14T01:00:00Z" } }, { count: 50, dimensions: { datetimeHour: "2026-10-14T02:00:00Z" } }],
};

function setup(fetchSummary: () => Promise<RawWafSummary>) {
  const store = new InMemoryWafStore();
  let now = NOW;
  const service = createWafService({
    source: { fetchSummary },
    store,
    audit: createAuditLog(new InMemoryAuditStore(), () => now),
    clock: () => now,
  });
  return { store, service, advance: (minutes: number) => (now = new Date(now.getTime() + minutes * 60_000)) };
}

describe("sampled WAF summary", () => {
  it("is always labelled sampled and carries no client addresses", async () => {
    const { service } = setup(async () => raw);
    await service.refresh("c");
    const summary = await service.getSampledWafSummary(op);
    expect(summary).toMatchObject({ sampled: true, status: "fresh", total: 120 });
    expect(summary.topPaths[1]!.path).toBe("/patient/*/report");
    expect(JSON.stringify(summary)).not.toMatch(/clientIP|\b\d{1,3}(\.\d{1,3}){3}\b/);
  });

  it("shows an API failure as unavailable, never as zero events", async () => {
    let fail = false;
    const { service } = setup(async () => {
      if (fail) throw new Error("Cloudflare API failed (HTTP 500)");
      return raw;
    });
    expect((await service.getSampledWafSummary(op)).status).toBe("unavailable");
    expect((await service.getSampledWafSummary(op)).total).toBeNull();
    await service.refresh("c");
    fail = true;
    await service.refresh("c");
    const summary = await service.getSampledWafSummary(op);
    expect(summary.status).toBe("error");
    expect(summary.lastError).toContain("HTTP 500");
    expect(summary.total).toBe(120); // last good data, still shown with its age
  });

  it("marks old data as stale", async () => {
    const { service, advance } = setup(async () => raw);
    await service.refresh("c");
    advance(90);
    expect((await service.getSampledWafSummary(op)).status).toBe("stale");
  });

  it("is not available to the Executive Viewer in technical form", async () => {
    const { service } = setup(async () => raw);
    await expect(service.getSampledWafSummary(exec)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("redactPath", () => {
  it("masks long numbers and identifiers in paths", () => {
    expect(redactPath("/api/v1/hn/0012345678")).toBe("/api/v1/hn/*");
    expect(redactPath("/x/550e8400-e29b-41d4-a716-446655440000")).toBe("/x/*");
    expect(redactPath("/wp-login.php")).toBe("/wp-login.php");
  });
});

describe("Cloudflare client", () => {
  it("sends a read-only GraphQL query and maps the zone result", async () => {
    let body = "";
    const client = createCloudflareClient({
      apiToken: "cf-token",
      zoneId: "zone",
      fetchImpl: (async (_url: string, init: RequestInit) => {
        body = String(init.body);
        return new Response(JSON.stringify({ data: { viewer: { zones: [{ ...raw, total: [{ count: 120 }] }] } }, errors: null }));
      }) as typeof fetch,
    });
    const summary = await client.fetchSummary({ since: new Date("2026-10-13T03:00:00Z"), until: NOW });
    expect(summary.total).toBe(120);
    expect(body).toContain("firewallEventsAdaptiveGroups");
    expect(body).not.toMatch(/mutation/);
  });

  it("reports token rejection without echoing the token", async () => {
    const client = createCloudflareClient({
      apiToken: "cf-token",
      zoneId: "zone",
      fetchImpl: (async () => new Response("bad token cf-token", { status: 403 })) as unknown as typeof fetch,
    });
    const error = (await client.fetchSummary({ since: NOW, until: NOW }).catch((e: Error) => e)) as Error;
    expect(error.message).toBe("Cloudflare rejected the API token (HTTP 403)");
  });
});
