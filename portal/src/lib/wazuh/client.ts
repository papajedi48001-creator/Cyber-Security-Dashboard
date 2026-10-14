import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { ALERT_SOURCE_FIELDS, type IndexerHit } from "./normalize-alert";

export interface AlertQuery {
  since: Date;
  searchAfter?: unknown[];
  size: number;
}

export interface WazuhAlertSource {
  searchAlerts(query: AlertQuery): Promise<IndexerHit[]>;
}

export class IndexerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexerError";
  }
}

export type Transport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; body: string }>;

/** Builds the search body. Only level >= 3 alerts and reference fields are requested. */
export function buildAlertSearch(query: AlertQuery) {
  return {
    size: query.size,
    _source: ALERT_SOURCE_FIELDS,
    sort: [{ timestamp: "asc" }, { _id: "asc" }],
    query: {
      bool: {
        filter: [{ range: { timestamp: { gte: query.since.toISOString() } } }, { range: { "rule.level": { gte: 3 } } }],
      },
    },
    ...(query.searchAfter ? { search_after: query.searchAfter } : {}),
  };
}

export function httpsTransport(caCertPath?: string): Transport {
  const ca = caCertPath ? readFileSync(caCertPath) : undefined;
  return (url, init) =>
    new Promise((resolve, reject) => {
      const req = httpsRequest(url, { method: init.method, headers: init.headers, ca, timeout: 15_000 }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end(init.body);
    });
}

export function createIndexerClient(options: {
  baseUrl: string;
  username: string;
  password: string;
  transport: Transport;
  indexPattern?: string;
}): WazuhAlertSource {
  const auth = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`;
  const url = `${options.baseUrl}/${options.indexPattern ?? "wazuh-alerts-*"}/_search`;
  return {
    async searchAlerts(query) {
      let response;
      try {
        response = await options.transport(url, {
          method: "POST",
          headers: { authorization: auth, "content-type": "application/json" },
          body: JSON.stringify(buildAlertSearch(query)),
        });
      } catch (error) {
        // Network errors carry no credentials, but keep the message generic and short.
        throw new IndexerError(`Indexer unreachable: ${error instanceof Error ? error.message.slice(0, 120) : "error"}`);
      }
      if (response.status === 401 || response.status === 403)
        throw new IndexerError(`Indexer rejected the service account (HTTP ${response.status})`);
      if (response.status !== 200) throw new IndexerError(`Indexer search failed (HTTP ${response.status})`);
      const parsed = JSON.parse(response.body) as { hits?: { hits?: IndexerHit[] } };
      return parsed.hits?.hits ?? [];
    },
  };
}
