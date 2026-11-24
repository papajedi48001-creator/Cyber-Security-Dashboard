// Module registry (ADR 0011): one entry per feature area of the Waritchaphum
// Security Dashboard. It drives navigation, the overview, module enablement and
// the per-role permission matrix, which is fixed in code and reviewed at UAT.

import type { Permission, Role } from "../auth/authorize";

export type ModuleAccess = "none" | "view" | "act" | "manage";

export type ModuleId =
  | "incidents"
  | "assets"
  | "log-sources"
  | "cloud-backup"
  | "db-replica"
  | "port-exposure"
  | "cloud-waf"
  | "duo"
  | "executive";

export interface ModuleDefinition {
  id: ModuleId;
  /** Thai display name. */
  name: string;
  href: string;
  /** Core modules cannot be turned off. */
  core: boolean;
  /** Used when no ModuleSetting record exists yet. */
  defaultEnabled: boolean;
  /** Core connectors the module reads. */
  connectors: string[];
  permissions: Record<Role, ModuleAccess>;
  /**
   * The existing page permission. Navigation shows a link only when the role
   * also holds it, so a link never leads to the forbidden page.
   */
  routePermission: Permission;
}

const OPS = { SECURITY_ADMINISTRATOR: "manage", SECURITY_OPERATOR: "act", EXECUTIVE_VIEWER: "none" } as const;

export const MODULES: readonly ModuleDefinition[] = [
  {
    id: "incidents",
    name: "เหตุการณ์ความปลอดภัย",
    href: "/incidents",
    core: true,
    defaultEnabled: true,
    connectors: ["wazuh-indexer"],
    permissions: { SECURITY_ADMINISTRATOR: "manage", SECURITY_OPERATOR: "act", EXECUTIVE_VIEWER: "view" },
    routePermission: "incident.read",
  },
  {
    id: "assets",
    name: "ทะเบียนทรัพย์สิน",
    href: "/assets",
    core: true,
    defaultEnabled: true,
    connectors: [],
    permissions: OPS,
    routePermission: "asset.read",
  },
  {
    id: "log-sources",
    name: "สุขภาพแหล่ง Log",
    href: "/sources",
    core: false,
    defaultEnabled: true,
    connectors: ["wazuh-indexer"],
    permissions: OPS,
    routePermission: "source.read",
  },
  {
    id: "cloud-backup",
    name: "Backup และ Cloud Backup",
    href: "/backups",
    core: false,
    defaultEnabled: true,
    connectors: ["gdcc-backup"],
    permissions: { SECURITY_ADMINISTRATOR: "manage", SECURITY_OPERATOR: "view", EXECUTIVE_VIEWER: "view" },
    routePermission: "evidence.read",
  },
  {
    id: "db-replica",
    name: "MariaDB Replica",
    href: "/replica",
    core: false,
    defaultEnabled: false,
    connectors: ["db-replica-reporter"],
    permissions: { SECURITY_ADMINISTRATOR: "manage", SECURITY_OPERATOR: "view", EXECUTIVE_VIEWER: "none" },
    routePermission: "evidence.read",
  },
  {
    id: "port-exposure",
    name: "พอร์ตเปิดสู่ภายนอก",
    href: "/port-monitor",
    core: false,
    defaultEnabled: true,
    connectors: ["exposure-scanner"],
    permissions: OPS,
    routePermission: "evidence.read",
  },
  {
    id: "cloud-waf",
    name: "Cloudflare WAF",
    href: "/web-application-firewall",
    core: false,
    defaultEnabled: true,
    connectors: ["cloudflare"],
    permissions: OPS,
    routePermission: "evidence.read",
  },
  {
    id: "duo",
    name: "Duo MFA",
    href: "/duo",
    core: false,
    defaultEnabled: true,
    connectors: [],
    permissions: OPS,
    routePermission: "evidence.read",
  },
  {
    id: "executive",
    name: "รายงานผู้บริหาร",
    href: "/executive",
    core: true,
    defaultEnabled: true,
    connectors: [],
    permissions: { SECURITY_ADMINISTRATOR: "manage", SECURITY_OPERATOR: "view", EXECUTIVE_VIEWER: "view" },
    routePermission: "executive.read",
  },
];

/** Stored enablement: module id to enabled flag. Missing ids use the default. */
export type ModuleSettings = Partial<Record<string, boolean>>;

export class ModuleLockedError extends Error {
  constructor(id: string) {
    super(`Module "${id}" is a core module and cannot be disabled`);
    this.name = "ModuleLockedError";
  }
}

export class UnknownModuleError extends Error {
  constructor(id: string) {
    super(`Unknown module "${id}"`);
    this.name = "UnknownModuleError";
  }
}

export function getModule(id: string): ModuleDefinition {
  const found = MODULES.find((m) => m.id === id);
  if (!found) throw new UnknownModuleError(id);
  return found;
}

export function isModuleId(id: string): id is ModuleId {
  return MODULES.some((m) => m.id === id);
}

export function isModuleEnabled(id: ModuleId, settings: ModuleSettings): boolean {
  const mod = getModule(id);
  if (mod.core) return true;
  return settings[id] ?? mod.defaultEnabled;
}

export function assertCanDisable(id: ModuleId): void {
  if (getModule(id).core) throw new ModuleLockedError(id);
}

export function accessFor(role: Role, id: ModuleId): ModuleAccess {
  return getModule(id).permissions[role];
}

/** Enabled modules the role may at least view, in registry order. */
export function visibleModules(role: Role, settings: ModuleSettings): ModuleDefinition[] {
  return MODULES.filter((m) => isModuleEnabled(m.id, settings) && m.permissions[role] !== "none");
}

/** Worker cycles that poll a module's connector; a disabled module's cycle is skipped. */
const CYCLE_MODULES: Record<string, ModuleId> = {
  intake: "incidents",
  source_health: "log-sources",
  ports: "port-exposure",
  cloudflare_waf: "cloud-waf",
};

export function moduleForCycle(cycle: string): ModuleId | undefined {
  return CYCLE_MODULES[cycle];
}
