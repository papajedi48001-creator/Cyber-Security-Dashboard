import { describe, expect, it } from "vitest";
import type { AuditInput, AuditLog } from "../audit";
import { ForbiddenError } from "../auth/authorize";
import { ModuleLockedError } from "./registry";
import { createModuleSettingsService, type ModuleSettingStore } from "./settings";

const admin = { id: "u-admin", username: "admin", role: "SECURITY_ADMINISTRATOR" as const };
const operator = { id: "u-op", username: "op", role: "SECURITY_OPERATOR" as const };

function setup() {
  const rows = new Map<string, { enabled: boolean; updatedBy: string }>();
  const store: ModuleSettingStore = {
    async all() {
      return Object.fromEntries([...rows].map(([id, r]) => [id, r.enabled]));
    },
    async set(id, enabled, updatedBy) {
      rows.set(id, { enabled, updatedBy });
    },
  };
  const entries: AuditInput[] = [];
  const audit: AuditLog = {
    async append(input) {
      entries.push(input);
      return { ...input, id: "a", at: new Date(), actorId: input.actor.id, actorLabel: input.actor.label, targetType: input.target.type, targetId: input.target.id ?? null, metadata: input.metadata ?? null };
    },
  };
  return { rows, entries, service: createModuleSettingsService({ store, audit }) };
}

describe("module settings", () => {
  it("lets an administrator disable an optional module and audits it", async () => {
    const { service, entries, rows } = setup();
    await service.setEnabled(admin, "cloud-waf", false, "c1");
    expect(rows.get("cloud-waf")).toEqual({ enabled: false, updatedBy: "u-admin" });
    expect(await service.settings()).toEqual({ "cloud-waf": false });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "module.disabled", target: { type: "Module", id: "cloud-waf" } });
  });

  it("refuses to disable a core module", async () => {
    const { service, rows } = setup();
    await expect(service.setEnabled(admin, "incidents", false, "c1")).rejects.toThrow(ModuleLockedError);
    expect(rows.size).toBe(0);
  });

  it("allows only administrators to change modules", async () => {
    const { service } = setup();
    await expect(service.setEnabled(operator, "duo", false, "c1")).rejects.toThrow(ForbiddenError);
  });

  it("rejects unknown module ids", async () => {
    const { service } = setup();
    await expect(service.setEnabled(admin, "nope", true, "c1")).rejects.toThrow();
  });
});
