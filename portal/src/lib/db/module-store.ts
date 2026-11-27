import type { PrismaClient } from "@prisma/client";
import type { ModuleId, ModuleSettings } from "../modules/registry";
import type { ModuleSettingStore } from "../modules/settings";

export class PrismaModuleSettingStore implements ModuleSettingStore {
  constructor(private readonly db: PrismaClient) {}

  async all(): Promise<ModuleSettings> {
    const rows = await this.db.moduleSetting.findMany();
    return Object.fromEntries(rows.map((r) => [r.id, r.enabled]));
  }

  async set(id: ModuleId, enabled: boolean, updatedBy: string) {
    await this.db.moduleSetting.upsert({ where: { id }, update: { enabled, updatedBy }, create: { id, enabled, updatedBy } });
  }
}
