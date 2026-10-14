import { describe, expect, it } from "vitest";
import { MalformedAlertError, normalizeWazuhAlert, suggestedSeverity } from "./normalize-alert";

const DASHBOARD = "https://wazuh.hospital.example";

function hit(source: Record<string, unknown>, id = "AbC123") {
  return { _id: id, _index: "wazuh-alerts-4.x-2026.10.14", _source: source };
}

const blocked = {
  id: "1728900000.12345",
  timestamp: "2026-10-14T10:00:00.000+0700",
  rule: { id: "100110", level: 5, description: "Sophos: traffic blocked by firewall rule (dst port 3389)", groups: ["sophos", "blocked_traffic"] },
  decoder: { name: "sophos-sfos" },
  agent: { name: "wazuh-server" },
  full_log: 'device_name="SFW" src_ip="203.0.113.50" user_name="someone"',
  data: { srcip: "203.0.113.50", srcuser: "someone" },
};

const categories: [string, string][] = [
  ["100110", "blocked_traffic"],
  ["100120", "admin_or_login_failure"],
  ["100130", "firewall_rule_change"],
  ["100140", "vpn_anomaly"],
  ["100150", "ips_av_web_event"],
  ["100160", "restricted_egress"],
  ["100181", "log_source_health"],
];

describe("normalizeWazuhAlert", () => {
  it.each(categories)("maps rule %s to category %s", (ruleId, category) => {
    const result = normalizeWazuhAlert(hit({ ...blocked, rule: { ...blocked.rule, id: ruleId, groups: ["sophos", category] } }), DASHBOARD);
    expect(result.kind).toBe("alert");
    if (result.kind === "alert") expect(result.alert.category).toBe(category);
  });

  it("keeps only reference fields and never the raw log or decoded data", () => {
    const result = normalizeWazuhAlert(hit(blocked), DASHBOARD);
    expect(result.kind).toBe("alert");
    if (result.kind !== "alert") return;
    expect(result.alert).toEqual({
      wazuhAlertId: "AbC123",
      ruleId: 100110,
      ruleLevel: 5,
      category: "blocked_traffic",
      description: "Sophos: traffic blocked by firewall rule (dst port 3389)",
      sourceName: "sophos-firewall",
      detectedAt: new Date("2026-10-14T03:00:00.000Z"),
      investigationUrl: expect.stringContaining(`${DASHBOARD}/app/`),
    });
    const text = JSON.stringify(result.alert);
    expect(text).not.toContain("203.0.113.50");
    expect(text).not.toContain("someone");
  });

  it("reports relay heartbeats as source activity, not alerts", () => {
    const result = normalizeWazuhAlert(
      hit({ ...blocked, rule: { id: "100183", level: 3, description: "TLS Log Relay heartbeat", groups: ["log_relay", "log_relay_heartbeat"] }, decoder: { name: "json" }, agent: { name: "log-relay" } }),
      DASHBOARD,
    );
    expect(result).toEqual({ kind: "heartbeat", sourceName: "log-relay", at: new Date("2026-10-14T03:00:00.000Z") });
  });

  it("ignores alerts outside the priority categories", () => {
    const result = normalizeWazuhAlert(hit({ ...blocked, rule: { ...blocked.rule, groups: ["syslog", "sshd"] } }), DASHBOARD);
    expect(result.kind).toBe("ignored");
  });

  it.each([
    ["missing rule", { ...blocked, rule: undefined }],
    ["bad timestamp", { ...blocked, timestamp: "not-a-date" }],
    ["non-numeric rule id", { ...blocked, rule: { ...blocked.rule, id: "abc" } }],
  ])("rejects a malformed alert: %s", (_name, source) => {
    expect(() => normalizeWazuhAlert(hit(source as Record<string, unknown>), DASHBOARD)).toThrow(MalformedAlertError);
  });

  it("does not echo raw data in the malformed-alert error", () => {
    try {
      normalizeWazuhAlert(hit({ ...blocked, timestamp: "bad" }), DASHBOARD);
    } catch (error) {
      expect(String(error)).not.toContain("203.0.113.50");
    }
  });
});

describe("suggestedSeverity", () => {
  it("maps Wazuh rule levels to P1-P4", () => {
    expect(suggestedSeverity(14)).toBe("P1");
    expect(suggestedSeverity(12)).toBe("P2");
    expect(suggestedSeverity(10)).toBe("P2");
    expect(suggestedSeverity(8)).toBe("P3");
    expect(suggestedSeverity(5)).toBe("P4");
  });
});
