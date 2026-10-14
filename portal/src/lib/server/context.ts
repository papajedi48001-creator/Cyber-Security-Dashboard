import { randomUUID } from "node:crypto";
import { createAssetService, type AssetService } from "../assets/service";
import { createAuditLog, type AuditLog } from "../audit";
import { createAuthService, type AuthService } from "../auth/service";
import { loadConfig, type PortalConfig } from "../config";
import { prisma } from "../db/client";
import { PrismaAssetStore } from "../db/asset-store";
import { PrismaAuditStore } from "../db/audit-store";
import { PrismaIncidentStore } from "../db/incident-store";
import { createIncidentService, type IncidentService } from "../incidents/service";
import { PrismaSessionStore, PrismaUserStore } from "../db/auth-stores";

export interface Services {
  config: PortalConfig;
  audit: AuditLog;
  auth: AuthService;
  assets: AssetService;
  incidents: IncidentService;
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
    assets: createAssetService({ store: new PrismaAssetStore(prisma), audit }),
    incidents: createIncidentService({ store: new PrismaIncidentStore(prisma), audit }),
  };
  return services;
}

export const newCorrelationId = () => randomUUID();
