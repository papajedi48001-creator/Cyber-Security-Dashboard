// Module registry (spec 2026-11-24, ADR 0011). Drives the left-rail navigation,
// the overview tiles and the per-module permission matrix.

import { can, type Permission, type Role } from "@/lib/auth/authorize";

export type ModuleId =
  | "incidents"
  | "assets"
  | "log-sources"
  | "cloud-backup"
  | "port-exposure"
  | "cloudflare-waf"
  | "duo-mfa"
  | "executive-report";

export type ModuleAccess = "none" | "view" | "act" | "manage";

export interface ModuleDefinition {
  id: ModuleId;
  /** Thai display name. */
  name: string;
  href: string;
  /** Core modules cannot be disabled. */
  core: boolean;
  /** Core connectors the module reads. */
  connectors: string[];
  /** Spec permission matrix; confirmed by the hospital at UAT. */
  permissions: Record<Role, ModuleAccess>;
  /** The permission the module's page already enforces. */
  pagePermission: Permission;
  /** An overview summary older than this renders as "ข้อมูลเก่า". */
  staleAfterMinutes: number;
}

const DAY = 24 * 60;

const ops = (executive: ModuleAccess): Record<Role, ModuleAccess> => ({
  SECURITY_ADMINISTRATOR: "manage",
  SECURITY_OPERATOR: "act",
  EXECUTIVE_VIEWER: executive,
});
const viewOnly = (executive: ModuleAccess): Record<Role, ModuleAccess> => ({
  SECURITY_ADMINISTRATOR: "manage",
  SECURITY_OPERATOR: "view",
  EXECUTIVE_VIEWER: executive,
});

export const MODULES: readonly ModuleDefinition[] = [
  {
    id: "incidents",
    name: "เหตุการณ์ความปลอดภัย",
    href: "/incidents",
    core: true,
    connectors: ["wazuh-indexer"],
    permissions: ops("view"),
    pagePermission: "incident.read",
    staleAfterMinutes: 10,
  },
  {
    id: "assets",
    name: "ทะเบียนทรัพย์สิน",
    href: "/assets",
    core: true,
    connectors: [],
    permissions: ops("none"),
    pagePermission: "asset.read",
    staleAfterMinutes: 365 * DAY,
  },
  {
    id: "log-sources",
    name: "สุขภาพแหล่ง Log",
    href: "/sources",
    core: false,
    connectors: ["wazuh-indexer"],
    permissions: ops("none"),
    pagePermission: "source.read",
    staleAfterMinutes: 10,
  },
  {
    id: "cloud-backup",
    name: "Cloud Backup",
    href: "/backups",
    core: false,
    connectors: ["gdcc-backup"],
    permissions: viewOnly("view"),
    pagePermission: "evidence.read",
    staleAfterMinutes: 2 * DAY,
  },
  {
    id: "port-exposure",
    name: "พอร์ตเปิดสู่ภายนอก",
    href: "/port-monitor",
    core: false,
    connectors: ["port-scanner"],
    permissions: ops("none"),
    pagePermission: "evidence.read",
    staleAfterMinutes: 2 * DAY,
  },
  {
    id: "cloudflare-waf",
    name: "Cloudflare WAF",
    href: "/web-application-firewall",
    core: false,
    connectors: ["cloudflare-graphql"],
    permissions: ops("none"),
    pagePermission: "evidence.read",
    staleAfterMinutes: 60,
  },
  {
    id: "duo-mfa",
    name: "Duo MFA",
    href: "/duo",
    core: false,
    connectors: [],
    permissions: ops("none"),
    pagePermission: "evidence.read",
    staleAfterMinutes: 7 * DAY,
  },
  {
    id: "executive-report",
    name: "รายงานผู้บริหาร",
    href: "/executive",
    core: true,
    connectors: [],
    permissions: viewOnly("view"),
    pagePermission: "executive.read",
    staleAfterMinutes: 365 * DAY,
  },
];

/** Enablement overrides keyed by module id; a missing key means enabled. */
export type ModuleSettings = Partial<Record<ModuleId, boolean>>;

export class ModuleSettingError extends Error {
  constructor(id: ModuleId) {
    super(`โมดูลหลัก ${id} ปิดไม่ได้`);
    this.name = "ModuleSettingError";
  }
}

function moduleById(id: ModuleId): ModuleDefinition {
  const found = MODULES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown module ${id}`);
  return found;
}

export function isEnabled(module: ModuleDefinition, settings: ModuleSettings): boolean {
  return module.core || settings[module.id] !== false;
}

export function applyModuleSetting(settings: ModuleSettings, id: ModuleId, enabled: boolean): ModuleSettings {
  if (moduleById(id).core && !enabled) throw new ModuleSettingError(id);
  return { ...settings, [id]: enabled };
}

export function moduleAccess(id: ModuleId, role: Role): ModuleAccess {
  return moduleById(id).permissions[role];
}

/**
 * Modules shown to a role: enabled, granted by the matrix, and openable with the
 * permission the page enforces today. Where the matrix grants more than a page
 * allows (Executive Viewer on Incidents and Cloud Backup), the page wins until
 * the hospital confirms the matrix.
 */
export function visibleModules(role: Role, settings: ModuleSettings): ModuleDefinition[] {
  return MODULES.filter(
    (m) => isEnabled(m, settings) && m.permissions[role] !== "none" && can({ id: "", role }, m.pagePermission),
  );
}

/** Connectors read by at least one enabled module. */
export function connectorsToPoll(settings: ModuleSettings): string[] {
  return [...new Set(MODULES.filter((m) => isEnabled(m, settings)).flatMap((m) => m.connectors))];
}

export interface NavLink {
  href: string;
  label: string;
}

/** The "ตั้งค่าระบบ" group; Security Administrators only. */
export function settingsNavigation(role: Role): NavLink[] {
  if (role !== "SECURITY_ADMINISTRATOR") return [];
  return [{ href: "/admin/users", label: "ผู้ใช้และสิทธิ์" }];
}
