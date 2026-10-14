// Turns a Wazuh Indexer alert hit into a Portal alert reference. Only reference
// fields leave this module: never full_log, data.*, IPs or usernames (ADR 0006).

export const PRIORITY_CATEGORIES = [
  "blocked_traffic",
  "admin_or_login_failure",
  "firewall_rule_change",
  "vpn_anomaly",
  "ips_av_web_event",
  "log_source_health",
  "restricted_egress",
] as const;
export type Category = (typeof PRIORITY_CATEGORIES)[number];
export type Severity = "P1" | "P2" | "P3" | "P4";

export const CATEGORY_LABELS: Record<Category, string> = {
  blocked_traffic: "การเชื่อมต่อถูกบล็อก",
  admin_or_login_failure: "เข้าสู่ระบบล้มเหลว",
  firewall_rule_change: "มีการเปลี่ยน Firewall Rule",
  vpn_anomaly: "VPN ผิดปกติ",
  ips_av_web_event: "IPS / Antivirus / Web protection",
  log_source_health: "แหล่ง Log ผิดปกติ",
  restricted_egress: "เชื่อมต่อออกไปยังพอร์ตที่ห้าม",
};

const HEARTBEAT_GROUP = "log_relay_heartbeat";
const SOURCE_BY_DECODER: Record<string, string> = { "sophos-sfos": "sophos-firewall" };

/** Fields requested from the Indexer; raw and decoded event data are never fetched. */
export const ALERT_SOURCE_FIELDS = [
  "id", "timestamp", "rule.id", "rule.level", "rule.description", "rule.groups", "decoder.name", "agent.name",
];

export interface IndexerHit {
  _id: string;
  _source: Record<string, unknown>;
  sort?: unknown[];
}

export interface NormalizedAlert {
  wazuhAlertId: string;
  ruleId: number;
  ruleLevel: number;
  category: Category;
  description: string;
  sourceName: string;
  detectedAt: Date;
  investigationUrl: string;
}

export type NormalizeResult =
  | { kind: "alert"; alert: NormalizedAlert }
  | { kind: "heartbeat"; sourceName: string; at: Date }
  | { kind: "ignored" };

export class MalformedAlertError extends Error {
  constructor(alertId: string, reason: string) {
    super(`Malformed Wazuh alert ${alertId}: ${reason}`);
    this.name = "MalformedAlertError";
  }
}

const get = (obj: unknown, key: string): unknown =>
  obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;

export function suggestedSeverity(ruleLevel: number): Severity {
  if (ruleLevel >= 13) return "P1";
  if (ruleLevel >= 10) return "P2";
  if (ruleLevel >= 7) return "P3";
  return "P4";
}

export function normalizeWazuhAlert(hit: IndexerHit, dashboardUrl: string): NormalizeResult {
  const id = typeof hit._id === "string" && hit._id ? hit._id : "(no id)";
  const source = hit._source;
  const rule = get(source, "rule");
  if (!rule) throw new MalformedAlertError(id, "missing rule");
  const ruleId = Number(get(rule, "id"));
  const ruleLevel = Number(get(rule, "level"));
  if (!Number.isInteger(ruleId) || !Number.isInteger(ruleLevel)) throw new MalformedAlertError(id, "invalid rule id or level");
  const detectedAt = new Date(String(get(source, "timestamp") ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (Number.isNaN(detectedAt.getTime())) throw new MalformedAlertError(id, "invalid timestamp");
  const groups = get(rule, "groups");
  const groupList = Array.isArray(groups) ? groups.map(String) : [];
  const decoderName = String(get(get(source, "decoder"), "name") ?? "");
  const agentName = String(get(get(source, "agent"), "name") ?? "unknown");
  const sourceName = SOURCE_BY_DECODER[decoderName] ?? (groupList.includes("log_relay") ? "log-relay" : agentName);

  if (groupList.includes(HEARTBEAT_GROUP)) return { kind: "heartbeat", sourceName, at: detectedAt };
  const category = PRIORITY_CATEGORIES.find((c) => groupList.includes(c));
  if (!category) return { kind: "ignored" };
  if (id === "(no id)") throw new MalformedAlertError(id, "missing document id");

  const query = encodeURIComponent(`_id:"${id}"`);
  return {
    kind: "alert",
    alert: {
      wazuhAlertId: id,
      ruleId,
      ruleLevel,
      category,
      description: String(get(rule, "description") ?? "").slice(0, 255),
      sourceName,
      detectedAt,
      investigationUrl: `${dashboardUrl}/app/threat-hunting#/overview/?_a=(query:(language:kuery,query:'${query}'))`,
    },
  };
}
