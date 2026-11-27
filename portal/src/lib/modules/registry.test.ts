import { describe, expect, it } from "vitest";
import {
  MODULES,
  ModuleLockedError,
  accessFor,
  assertCanDisable,
  isModuleEnabled,
  moduleForCycle,
  visibleModules,
  type ModuleId,
} from "./registry";

const ALL_ON = Object.fromEntries(MODULES.map((m) => [m.id, true]));

describe("module registry", () => {
  it("registers every existing module page", () => {
    const hrefs = MODULES.map((m) => m.href).sort();
    for (const page of [
      "/incidents",
      "/assets",
      "/sources",
      "/backups",
      "/port-monitor",
      "/web-application-firewall",
      "/duo",
      "/executive",
      "/replica",
    ]) {
      expect(hrefs).toContain(page);
    }
  });

  it("uses unique ids", () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("locks core modules on", () => {
    for (const id of ["incidents", "assets", "executive"] as ModuleId[]) {
      expect(() => assertCanDisable(id)).toThrow(ModuleLockedError);
      expect(isModuleEnabled(id, { [id]: false })).toBe(true);
    }
    expect(() => assertCanDisable("cloud-waf")).not.toThrow();
  });

  it("follows the permission matrix of the spec", () => {
    expect(accessFor("SECURITY_ADMINISTRATOR", "db-replica")).toBe("manage");
    expect(accessFor("SECURITY_OPERATOR", "incidents")).toBe("act");
    expect(accessFor("SECURITY_OPERATOR", "cloud-backup")).toBe("view");
    expect(accessFor("SECURITY_OPERATOR", "db-replica")).toBe("view");
    expect(accessFor("EXECUTIVE_VIEWER", "assets")).toBe("none");
    expect(accessFor("EXECUTIVE_VIEWER", "db-replica")).toBe("none");
    expect(accessFor("EXECUTIVE_VIEWER", "executive")).toBe("view");
    for (const m of MODULES) expect(accessFor("SECURITY_ADMINISTRATOR", m.id)).toBe("manage");
  });

  it("shows each role only the modules it may view", () => {
    const ids = (role: Parameters<typeof visibleModules>[0]) => visibleModules(role, ALL_ON).map((m) => m.id);
    expect(ids("EXECUTIVE_VIEWER")).toEqual(["incidents", "cloud-backup", "executive"]);
    expect(ids("SECURITY_OPERATOR")).toContain("db-replica");
    expect(ids("SECURITY_ADMINISTRATOR")).toHaveLength(MODULES.length);
  });

  it("hides a disabled module and falls back to its default when unset", () => {
    const ids = visibleModules("SECURITY_ADMINISTRATOR", { "cloud-waf": false }).map((m) => m.id);
    expect(ids).not.toContain("cloud-waf");
    expect(isModuleEnabled("db-replica", {})).toBe(MODULES.find((m) => m.id === "db-replica")!.defaultEnabled);
  });

  it("does not poll the connector of a disabled module", () => {
    expect(moduleForCycle("ports")).toBe("port-exposure");
    expect(moduleForCycle("cloudflare_waf")).toBe("cloud-waf");
    expect(moduleForCycle("source_health")).toBe("log-sources");
    expect(isModuleEnabled(moduleForCycle("ports")!, { "port-exposure": false })).toBe(false);
    expect(moduleForCycle("intake")).toBe("incidents");
    expect(moduleForCycle("backup_inbox")).toBe("cloud-backup");
    expect(moduleForCycle("replica")).toBe("cloud-backup");
  });
});
