// Read-only Cloudflare GraphQL Analytics adapter for sampled WAF (firewall)
// events. The token needs only Zone > Analytics > Read for the hospital zone.
// Field names follow the GraphQL Analytics schema (firewallEventsAdaptiveGroups);
// confirm the Free plan's lookback window with the real token before UAT.

export const CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const TIMEOUT_MS = 15_000;

export class CloudflareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareError";
  }
}

export interface Group<K extends string> {
  count: number;
  dimensions: Record<K, string>;
}

export interface RawWafSummary {
  total: number;
  byAction: Group<"action">[];
  byPath: Group<"clientRequestPath">[];
  byCountry: Group<"clientCountryName">[];
  bySource: Group<"source">[];
  trend: Group<"datetimeHour">[];
}

export interface WafSource {
  fetchSummary(range: { since: Date; until: Date }): Promise<RawWafSummary>;
}

const QUERY = `
query SampledWaf($zoneTag: string, $filter: FirewallEventsAdaptiveGroupsFilter_InputObject) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      total: firewallEventsAdaptiveGroups(limit: 1, filter: $filter) { count }
      byAction: firewallEventsAdaptiveGroups(limit: 10, filter: $filter, orderBy: [count_DESC]) { count dimensions { action } }
      byPath: firewallEventsAdaptiveGroups(limit: 10, filter: $filter, orderBy: [count_DESC]) { count dimensions { clientRequestPath } }
      byCountry: firewallEventsAdaptiveGroups(limit: 10, filter: $filter, orderBy: [count_DESC]) { count dimensions { clientCountryName } }
      bySource: firewallEventsAdaptiveGroups(limit: 10, filter: $filter, orderBy: [count_DESC]) { count dimensions { source } }
      trend: firewallEventsAdaptiveGroups(limit: 200, filter: $filter, orderBy: [datetimeHour_ASC]) { count dimensions { datetimeHour } }
    }
  }
}`;

export function createCloudflareClient({
  apiToken,
  zoneId,
  fetchImpl = fetch,
}: {
  apiToken: string;
  zoneId: string;
  fetchImpl?: typeof fetch;
}): WafSource {
  return {
    async fetchSummary({ since, until }) {
      let response: Response;
      try {
        response = await fetchImpl(CLOUDFLARE_GRAPHQL_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
          body: JSON.stringify({
            query: QUERY,
            variables: { zoneTag: zoneId, filter: { datetime_geq: since.toISOString(), datetime_lt: until.toISOString() } },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new CloudflareError(`Cloudflare unreachable: ${error instanceof Error ? error.name : "network error"}`);
      }
      if (response.status === 401 || response.status === 403) throw new CloudflareError(`Cloudflare rejected the API token (HTTP ${response.status})`);
      if (!response.ok) throw new CloudflareError(`Cloudflare API failed (HTTP ${response.status})`);
      const body = (await response.json()) as {
        data?: { viewer?: { zones?: (Omit<RawWafSummary, "total"> & { total: { count: number }[] })[] } };
        errors?: { message?: string }[] | null;
      };
      if (body.errors?.length) throw new CloudflareError(`Cloudflare query error: ${String(body.errors[0]?.message ?? "unknown").slice(0, 160)}`);
      const zone = body.data?.viewer?.zones?.[0];
      if (!zone) throw new CloudflareError("Cloudflare returned no data for the zone");
      return { ...zone, total: zone.total[0]?.count ?? 0 };
    },
  };
}
