import { describe, expect, it } from "vitest";
import { connectorFreshness, evaluateSourceHealth, findSilentSources } from "./source-health";

const NOW = new Date("2026-10-14T03:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const freshConnector = { lastSuccessAt: minutesAgo(1), lastAttemptAt: minutesAgo(1), lastError: null };
const source = (lastEventAt: Date | null) => ({ name: "sophos-firewall", expectedIntervalMinutes: 5, lastEventAt });

describe("evaluateSourceHealth", () => {
  it("is healthy when the source reported within its expected interval", () => {
    expect(evaluateSourceHealth(source(minutesAgo(2)), NOW, freshConnector, 60).status).toBe("healthy");
  });

  it("is stale when the source is silent longer than its interval", () => {
    const health = evaluateSourceHealth(source(minutesAgo(12)), NOW, freshConnector, 60);
    expect(health.status).toBe("stale");
    expect(health.silentMinutes).toBe(12);
  });

  it("is unknown when the source has never reported", () => {
    expect(evaluateSourceHealth(source(null), NOW, freshConnector, 60).status).toBe("unknown");
  });

  it("is unknown, never healthy, when the Wazuh connector itself is stale", () => {
    const staleConnector = { lastSuccessAt: minutesAgo(30), lastAttemptAt: minutesAgo(1), lastError: "HTTP 401" };
    const health = evaluateSourceHealth(source(minutesAgo(1)), NOW, staleConnector, 60);
    expect(health.status).toBe("unknown");
    expect(health.reason).toContain("Wazuh");
  });
});

describe("connectorFreshness", () => {
  it("is fresh within three poll intervals", () => {
    expect(connectorFreshness(freshConnector, NOW, 60).status).toBe("fresh");
  });

  it("is stale after three missed polls or when it never succeeded", () => {
    expect(connectorFreshness({ ...freshConnector, lastSuccessAt: minutesAgo(4) }, NOW, 60).status).toBe("stale");
    expect(connectorFreshness({ lastSuccessAt: null, lastAttemptAt: null, lastError: null }, NOW, 60).status).toBe("stale");
  });
});

describe("findSilentSources", () => {
  const fresh = { lastSuccessAt: NOW, lastAttemptAt: NOW, lastError: null };
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

  it("reports stale sources with their criticality and skips never-seen ones", () => {
    const silent = findSilentSources(
      [
        { name: "sophos-firewall", expectedIntervalMinutes: 15, lastEventAt: minutesAgo(30), critical: true },
        { name: "relay", expectedIntervalMinutes: 15, lastEventAt: minutesAgo(5), critical: false },
        { name: "new-source", expectedIntervalMinutes: 15, lastEventAt: null, critical: false },
      ],
      fresh,
      "wazuh-indexer",
      NOW,
      60,
    );
    expect(silent).toEqual([{ name: "sophos-firewall", critical: true, reason: expect.any(String), since: minutesAgo(30) }]);
  });

  it("reports only the connector when Wazuh itself is unreachable", () => {
    const stale = { lastSuccessAt: minutesAgo(30), lastAttemptAt: NOW, lastError: "Indexer unreachable" };
    const silent = findSilentSources(
      [{ name: "sophos-firewall", expectedIntervalMinutes: 15, lastEventAt: minutesAgo(30), critical: true }],
      stale,
      "wazuh-indexer",
      NOW,
      60,
    );
    expect(silent.map((s) => [s.name, s.critical])).toEqual([["wazuh-indexer", true]]);
  });
});
