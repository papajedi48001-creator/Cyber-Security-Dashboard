// Module enablement, changed only by a Security Administrator in System Settings.
// Every change is audited; core modules stay on.

import type { AuditLog } from "../audit";
import { requirePermission, type Principal } from "../auth/authorize";
import { assertCanDisable, getModule, type ModuleId, type ModuleSettings } from "./registry";

export interface ModuleSettingStore {
  all(): Promise<ModuleSettings>;
  set(id: ModuleId, enabled: boolean, updatedBy: string): Promise<void>;
}

export interface ModuleSettingsService {
  settings(): Promise<ModuleSettings>;
  setEnabled(actor: Principal & { username: string }, id: string, enabled: boolean, correlationId: string): Promise<void>;
}

export function createModuleSettingsService(deps: { store: ModuleSettingStore; audit: AuditLog }): ModuleSettingsService {
  return {
    settings: () => deps.store.all(),
    async setEnabled(actor, id, enabled, correlationId) {
      requirePermission(actor, "config.manage");
      const mod = getModule(id);
      if (!enabled) assertCanDisable(mod.id);
      await deps.store.set(mod.id, enabled, actor.id);
      await deps.audit.append({
        actor: { id: actor.id, label: actor.username },
        action: enabled ? "module.enabled" : "module.disabled",
        target: { type: "Module", id: mod.id },
        correlationId,
      });
    },
  };
}
