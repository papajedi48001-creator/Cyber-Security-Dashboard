import { randomUUID } from "node:crypto";
import { createAssetService, type AssetService } from "../assets/service";
import { createAuditLog, type AuditLog } from "../audit";
import { createProviderIdLogin, type ProviderIdClient, type ProviderIdLogin } from "../auth/provider-id";
import { createAuthService, type AuthService } from "../auth/service";
import { loadConfig, type PortalConfig } from "../config";
import { prisma } from "../db/client";
import { PrismaAssetStore } from "../db/asset-store";
import { PrismaAuditStore } from "../db/audit-store";
import { PrismaBackupStore } from "../db/backup-store";
import { createBackupService, type BackupService } from "../backups/service";
import { PrismaDeliveryStore } from "../db/delivery-store";
import { PrismaIncidentStore } from "../db/incident-store";
import { PrismaPortStore } from "../db/port-store";
import { PrismaDuoCheckStore, PrismaWafStore } from "../db/waf-duo-stores";
import { createCloudflareClient } from "../cloudflare/client";
import { createWafService, type WafService } from "../cloudflare/service";
import { createDuoManualCheckService, type DuoManualCheckService } from "../duo/manual-check";
import { createPortMonitorService, type PortMonitorService } from "../port-monitor/service";
import { createIncidentService, type IncidentService } from "../incidents/service";
import { createEmailChannel, createLineChannel } from "../notifications/channels";
import { createNotifier, type NotificationChannel, type Notifier } from "../notifications/delivery";
import { PrismaExternalIdentityStore, PrismaSessionStore, PrismaUserStore } from "../db/auth-stores";

export interface Services {
  config: PortalConfig;
  audit: AuditLog;
  auth: AuthService;
  /** Null until a real Provider ID client is configured (ADR 0009); the login page then hides the option. */
  providerId: ProviderIdLogin | null;
  assets: AssetService;
  incidents: IncidentService;
  notifier: Notifier;
  backups: BackupService;
  ports: PortMonitorService;
  waf: WafService;
  duo: DuoManualCheckService;
}

let services: Services | undefined;

/** Builds services once per server process; fails fast on invalid configuration. */
export function getServices(): Services {
  if (services) return services;
  const config = loadConfig();
  const audit = createAuditLog(new PrismaAuditStore(prisma));
  const channels: NotificationChannel[] = [];
  if (config.notifications.email) channels.push(createEmailChannel(config.notifications.email));
  if (config.notifications.line) channels.push(createLineChannel(config.notifications.line));
  const notifier = createNotifier({
    store: new PrismaDeliveryStore(prisma),
    channels,
    audit,
    portalBaseUrl: config.portalBaseUrl,
  });
  const auth = createAuthService({
    users: new PrismaUserStore(prisma),
    sessions: new PrismaSessionStore(prisma),
    externalIdentities: new PrismaExternalIdentityStore(prisma),
    audit,
    totpKey: config.totpEncryptionKey,
  });
  // The Health ID / Provider ID HTTP adapter is written once the hospital's client registration
  // and the official API documentation are available (plan 2026-10-14-provider-id-login, Task 6).
  const providerIdClient: ProviderIdClient | null = null;
  const ports = createPortMonitorService({ store: new PrismaPortStore(prisma), audit });
  services = {
    config,
    audit,
    auth,
    providerId:
      providerIdClient && config.providerId
        ? createProviderIdLogin({
            client: providerIdClient,
            auth,
            audit,
            hospitalCode: config.providerId.hospitalCode,
            redirectUri: `${config.portalBaseUrl}/login/provider-id/callback`,
          })
        : null,
    assets: createAssetService({ store: new PrismaAssetStore(prisma), audit }),
    incidents: createIncidentService({
      store: new PrismaIncidentStore(prisma),
      audit,
      notify: notifier.enqueue,
      suppressAlert: ports.isEgressExcepted,
    }),
    notifier,
    backups: createBackupService({ store: new PrismaBackupStore(prisma), audit }),
    ports,
    waf: createWafService({
      source: config.cloudflare ? createCloudflareClient(config.cloudflare) : null,
      store: new PrismaWafStore(prisma),
      audit,
    }),
    duo: createDuoManualCheckService({ store: new PrismaDuoCheckStore(prisma), audit }),
  };
  return services;
}

export const newCorrelationId = () => randomUUID();
