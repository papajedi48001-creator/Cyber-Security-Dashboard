import { randomUUID } from "node:crypto";
import { createAuditLog, type AuditLog } from "../audit";
import { createAuthService, type AuthService } from "../auth/service";
import { loadConfig, type PortalConfig } from "../config";
import { prisma } from "../db/client";
import { PrismaAuditStore } from "../db/audit-store";
import { PrismaSessionStore, PrismaUserStore } from "../db/auth-stores";

export interface Services {
  config: PortalConfig;
  audit: AuditLog;
  auth: AuthService;
}

let services: Services | undefined;

/** Builds services once per server process; fails fast on invalid configuration. */
export function getServices(): Services {
  if (services) return services;
  const config = loadConfig();
  const audit = createAuditLog(new PrismaAuditStore(prisma));
  services = {
    config,
    audit,
    auth: createAuthService({
      users: new PrismaUserStore(prisma),
      sessions: new PrismaSessionStore(prisma),
      audit,
      totpKey: config.totpEncryptionKey,
    }),
  };
  return services;
}

export const newCorrelationId = () => randomUUID();
