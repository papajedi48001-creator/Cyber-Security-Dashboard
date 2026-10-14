export type Role = "SECURITY_ADMINISTRATOR" | "SECURITY_OPERATOR" | "EXECUTIVE_VIEWER";

export type Permission =
  | "incident.read"
  | "incident.write"
  | "incident.review"
  | "evidence.read"
  | "asset.read"
  | "asset.write"
  | "source.read"
  | "user.manage"
  | "config.manage"
  | "audit.read"
  | "executive.read";

const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  SECURITY_ADMINISTRATOR: new Set<Permission>([
    "incident.read", "incident.write", "incident.review", "evidence.read", "asset.read", "asset.write",
    "source.read", "user.manage", "config.manage", "audit.read", "executive.read",
  ]),
  SECURITY_OPERATOR: new Set<Permission>([
    "incident.read", "incident.write", "incident.review", "evidence.read", "asset.read", "source.read", "executive.read",
  ]),
  EXECUTIVE_VIEWER: new Set<Permission>(["executive.read"]),
};

export const ROLE_LABELS: Record<Role, string> = {
  SECURITY_ADMINISTRATOR: "Security Administrator",
  SECURITY_OPERATOR: "Security Operator",
  EXECUTIVE_VIEWER: "Executive Viewer",
};

/** Generic denial; the message never names the protected record. */
export class ForbiddenError extends Error {
  constructor() {
    super("ไม่มีสิทธิ์ดำเนินการนี้");
    this.name = "ForbiddenError";
  }
}

export interface Principal {
  id: string;
  role: Role;
}

export function can(user: Principal, permission: Permission): boolean {
  return PERMISSIONS[user.role].has(permission);
}

export function requirePermission<T extends Principal>(user: T | null | undefined, permission: Permission): T {
  if (!user || !can(user, permission)) throw new ForbiddenError();
  return user;
}

export function requireRole<T extends Principal>(user: T | null | undefined, roles: readonly Role[]): T {
  if (!user || !roles.includes(user.role)) throw new ForbiddenError();
  return user;
}
