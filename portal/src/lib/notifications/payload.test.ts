import { describe, expect, it } from "vitest";
import { buildNotificationSummary, renderNotificationText } from "./payload";

const incident = {
  id: "inc-1",
  number: "INC-2026-0007",
  title: "Admin login failure from 10.1.2.3 by user somchai HN 1234567890123",
  severity: "P1" as const,
  detectedAt: new Date("2026-10-14T17:05:00Z"),
  sourceName: "sophos-firewall",
  cause: "secret root cause",
};

describe("buildNotificationSummary", () => {
  it("contains only severity, number, detection time, system name and Portal link", () => {
    const summary = buildNotificationSummary(incident, "https://portal.hospital.example");
    expect(Object.keys(summary).sort()).toEqual(["detectedAt", "incidentNumber", "link", "severity", "systemName"]);
    expect(summary).toMatchObject({
      severity: "P1",
      incidentNumber: "INC-2026-0007",
      systemName: "sophos-firewall",
      link: "https://portal.hospital.example/incidents/inc-1",
    });
  });

  it("never carries the title, cause, addresses, usernames or patient identifiers", () => {
    const text = renderNotificationText(buildNotificationSummary(incident, "https://portal.hospital.example"));
    for (const leak of ["Admin login", "10.1.2.3", "somchai", "1234567890123", "secret root cause"]) expect(text).not.toContain(leak);
    expect(text).toContain("INC-2026-0007");
    expect(text).toContain("15 ต.ค. 2569 00:05"); // Asia/Bangkok display
  });

  it("withholds a system name that looks like an address", () => {
    expect(buildNotificationSummary({ ...incident, sourceName: "10.0.0.5" }, "https://p").systemName).toBe("ไม่ระบุ");
    expect(buildNotificationSummary({ ...incident, sourceName: null }, "https://p").systemName).toBe("ไม่ระบุ");
  });
});
