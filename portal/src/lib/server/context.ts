import { randomUUID } from "node:crypto";
import { createAssetService, type AssetService } from "../assets/service";
import { createAuditLog, type AuditLog } from "../audit";
import { createAuditReader, type AuditReader } from "../audit-reader";
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
import { PrismaSessionStore, PrismaUserStore } from "../db/auth-stores";
import { PrismaModuleSettingStore } from "../db/module-store";
import { PrismaConnectorStore } from "../db/connector-store";
import { createConnectorSettings, type ConnectorSettings } from "../settings/connectors";
import { createSecretBox } from "../settings/secrets";
import { createModuleSettingsService, type ModuleSettingsService } from "../modules/settings";
import { PrismaReplicaStore } from "../db/replica-store";
import { replicaTargets, type ReplicaStore, type ReplicaTarget } from "../replica/service";

export interface Services {
  config: PortalConfig;
  audit: AuditLog;
  auth: AuthService;
  assets: AssetService;
  incidents: IncidentService;
  notifier: Notifier;
  backups: BackupService;
  ports: PortMonitorService;
  waf: WafService;
  duo: DuoManualCheckService;
  modules: ModuleSettingsService;
  auditReader: AuditReader;
  connectors: ConnectorSettings;
  /** GDCC replica connections (Portal always, HOSxP when set): latest stored check, written by the worker. */
  replicas: (ReplicaTarget & { connection: string; configured: boolean; store: ReplicaStore })[];
}

let services: Services | undefined;

/** Builds services once per server process; fails fast on invalid configuration. */
export function getServices(): Services {
  if (services) return services;
  const config = loadConfig();
  const auditStore = new PrismaAuditStore(prisma);
  const audit = createAuditLog(auditStore);
  const channels: NotificationChannel[] = [];
  if (config.notifications.email) channels.push(createEmailChannel(config.notifications.email));
  if (config.notifications.line) channels.push(createLineChannel(config.notifications.line));
  const notifier = createNotifier({
    store: new PrismaDeliveryStore(prisma),
    channels,
    audit,
    portalBaseUrl: config.portalBaseUrl,
  });
  const connectors = createConnectorSettings({
    store: new PrismaConnectorStore(prisma),
    audit,
    box: config.settingsEncryptionKey ? createSecretBox(config.settingsEncryptionKey) : null,
    env: {
      "wazuh-indexer": { target: config.wazuh.indexerUrl, username: config.wazuh.username, secret: config.wazuh.password },
      ...(config.cloudflare ? { cloudflare: { target: config.cloudflare.zoneId, username: null, secret: config.cloudflare.apiToken } } : {}),
    },
    status: async (name) => {
      const row = await prisma.connectorState.findUnique({ where: { name } });
      return { lastSuccessAt: row?.lastSuccessAt ?? null, lastError: row?.lastError ?? null };
    },
  });
  const ports = createPortMonitorService({ store: new PrismaPortStore(prisma), audit });
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
      source: async () => {
        const cf = await connectors.effective("cloudflare");
        return cf?.secret ? createCloudflareClient({ apiToken: cf.secret, zoneId: cf.target }) : null;
      },
      store: new PrismaWafStore(prisma),
      audit,
    }),
    duo: createDuoManualCheckService({ store: new PrismaDuoCheckStore(prisma), audit }),
    modules: createModuleSettingsService({ store: new PrismaModuleSettingStore(prisma), audit }),
    auditReader: createAuditReader(auditStore),
    connectors,
    replicas: replicaTargets(config.replicaConnections).map((target) => ({
      ...target,
      configured: Boolean(config.replicaMonitorUrl),
      store: new PrismaReplicaStore(prisma, target.source),
    })),
  };
  return services;
}

export const newCorrelationId = () => randomUUID();
