import { describe, expect, it } from "vitest";
import {
  MODULES,
  ModuleSettingError,
  applyModuleSetting,
  connectorsToPoll,
  moduleAccess,
  settingsNavigation,
  visibleModules,
  type ModuleSettings,
} from "./registry";

const ALL_ENABLED: ModuleSettings = {};

describe("module registry", () => {
  it("registers every existing module page once", () => {
    expect(MODULES.map((m) => m.href).sort()).toEqual(
      [
        "/assets",
        "/backups",
        "/duo",
        "/executive",
        "/incidents",
        "/port-monitor",
        "/sources",
        "/web-application-firewall",
      ].sort(),
    );
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(MODULES.length);
  });

  it("marks Security Incidents, Asset Register and Executive Reporting as core", () => {
    expect(MODULES.filter((m) => m.core).map((m) => m.id).sort()).toEqual(["assets", "executive-report", "incidents"]);
  });

  it("refuses to disable a core module", () => {
    expect(() => applyModuleSetting(ALL_ENABLED, "incidents", false)).toThrow(ModuleSettingError);
    expect(applyModuleSetting(ALL_ENABLED, "cloud-backup", false)).toEqual({ "cloud-backup": false });
  });

  it("follows the spec permission matrix", () => {
    expect(moduleAccess("incidents", "SECURITY_ADMINISTRATOR")).toBe("manage");
    expect(moduleAccess("incidents", "SECURITY_OPERATOR")).toBe("act");
    expect(moduleAccess("cloud-backup", "SECURITY_OPERATOR")).toBe("view");
    expect(moduleAccess("assets", "EXECUTIVE_VIEWER")).toBe("none");
    expect(moduleAccess("executive-report", "EXECUTIVE_VIEWER")).toBe("view");
  });

  it("shows administrators and operators every enabled module", () => {
    const ids = MODULES.map((m) => m.id);
    expect(visibleModules("SECURITY_ADMINISTRATOR", ALL_ENABLED).map((m) => m.id)).toEqual(ids);
    expect(visibleModules("SECURITY_OPERATOR", ALL_ENABLED).map((m) => m.id)).toEqual(ids);
  });

  it("shows an Executive Viewer only the pages their role can open", () => {
    expect(visibleModules("EXECUTIVE_VIEWER", ALL_ENABLED).map((m) => m.id)).toEqual(["executive-report"]);
  });

  it("hides a disabled module and stops polling its connector", () => {
    const settings = applyModuleSetting(ALL_ENABLED, "cloudflare-waf", false);
    expect(visibleModules("SECURITY_ADMINISTRATOR", settings).map((m) => m.id)).not.toContain("cloudflare-waf");
    expect(connectorsToPoll(ALL_ENABLED)).toContain("cloudflare-graphql");
    expect(connectorsToPoll(settings)).not.toContain("cloudflare-graphql");
    expect(connectorsToPoll(settings)).toContain("wazuh-indexer");
  });

  it("shows System Settings to Security Administrators only", () => {
    expect(settingsNavigation("SECURITY_ADMINISTRATOR").map((l) => l.href)).toEqual(["/admin/users"]);
    expect(settingsNavigation("SECURITY_OPERATOR")).toEqual([]);
    expect(settingsNavigation("EXECUTIVE_VIEWER")).toEqual([]);
  });
});
