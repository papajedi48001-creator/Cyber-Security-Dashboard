// Portal background worker: run beside the web process (`npm run worker`).
// Polls Wazuh, opens incidents, watches source health and port exposure, sends
// notifications, and (when configured) imports GDCC backup evidence and checks
// each connection of the GDCC database replica (Portal, HOSxP).

import { randomUUID } from "node:crypto";
import { prisma } from "./lib/db/client";
import { PrismaIntakeStore } from "./lib/db/intake-store";
import { replicaStatusReader } from "./lib/db/replica-store";
import { processEvidenceInbox } from "./lib/backups/inbox";
import { createReplicaMonitor } from "./lib/replica/service";
import { getServices } from "./lib/server/context";
import { silentSources } from "./lib/sources";
import { createIndexerClient, httpsTransport, type WazuhAlertSource } from "./lib/wazuh/client";
import { pollWazuhAlerts } from "./lib/wazuh/poller";
import { isModuleEnabled, moduleForCycle } from "./lib/modules/registry";
import { createWorkerCycles } from "./lib/worker/cycles";

const NOTIFY_INTERVAL_MS = 30_000;
const SOURCE_HEALTH_INTERVAL_MS = 60_000;
const PORT_INTERVAL_MS = 5 * 60_000;
const WAF_INTERVAL_MS = 15 * 60_000;
const BACKUP_INBOX_INTERVAL_MS = 5 * 60_000;
const REPLICA_INTERVAL_MS = 5 * 60_000;

const log = (event: string, detail: Record<string, unknown>) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...detail }));

const { config, audit, incidents, notifier, ports, waf, backups, replicas, modules, connectors } = getServices();
const inbox = config.backupEvidenceInbox;
const readReplica = config.replicaMonitorUrl ? replicaStatusReader(config.replicaMonitorUrl) : null;
const replicaMonitors = readReplica
  ? replicas.map((target) => ({
      source: target.source,
      check: createReplicaMonitor({ target, fetchStatus: readReplica(target.connection), store: target.store }).check,
    }))
  : [];
// Credentials come from System Settings › การเชื่อมต่อ (seeded once from the
// environment) and are resolved on every poll, so a change needs no restart.
const transport = httpsTransport(config.wazuh.caCertPath);
const source: WazuhAlertSource = {
  async searchAlerts(query) {
    const indexer = await connectors.effective("wazuh-indexer");
    if (!indexer?.username || !indexer.secret) throw new Error("ยังไม่ได้ตั้งค่าการเชื่อมต่อ Wazuh Indexer");
    return createIndexerClient({ baseUrl: indexer.target.replace(/\/$/, ""), username: indexer.username, password: indexer.secret, transport }).searchAlerts(query);
  },
};
void connectors.bootstrap().catch((error) => log("connectors.bootstrap_failed", { error: String(error).slice(0, 200) }));
const intakeStore = new PrismaIntakeStore(prisma);

const cycles = createWorkerCycles({
  poll: () => pollWazuhAlerts({ source, store: intakeStore, audit, dashboardUrl: config.wazuh.dashboardUrl }),
  incidents,
  notifier,
  silentSources: () => silentSources(prisma, config.wazuh.pollIntervalSeconds),
  portFindings: ports.findingsForIncidents,
  refreshWaf: waf.refresh,
  importBackupInbox: inbox
    ? (correlationId) => processEvidenceInbox(inbox, (csv, source) => backups.importSystemReport(csv, source, correlationId))
    : undefined,
  checkReplicas: replicaMonitors,
  log,
  newCorrelationId: randomUUID,
});

let stopping = false;
const timers = new Map<string, NodeJS.Timeout>();

/** Runs a cycle, then waits the full interval before the next one, so runs never overlap. */
function every(name: string, intervalMs: number, cycle: () => Promise<void>) {
  const moduleId = moduleForCycle(name);
  const run = async () => {
    // A disabled module is not polled; its stored records stay (ADR 0011).
    const enabled = moduleId ? isModuleEnabled(moduleId, await modules.settings().catch(() => ({}))) : true;
    if (enabled) await cycle();
    if (!stopping) timers.set(name, setTimeout(run, intervalMs));
  };
  void run();
}

if (notifier.channelsConfigured.length === 0) log("notifications.unconfigured", { message: "no Email or LINE channel configured" });
log("worker.started", { pollIntervalSeconds: config.wazuh.pollIntervalSeconds, channels: notifier.channelsConfigured });
every("intake", config.wazuh.pollIntervalSeconds * 1000, cycles.intake);
every("source_health", SOURCE_HEALTH_INTERVAL_MS, cycles.sourceHealth);
every("ports", PORT_INTERVAL_MS, cycles.ports);
every("cloudflare_waf", WAF_INTERVAL_MS, cycles.waf);
every("notifications", NOTIFY_INTERVAL_MS, cycles.notifications);
if (inbox) every("backup_inbox", BACKUP_INBOX_INTERVAL_MS, cycles.backupInbox);
if (replicaMonitors.length) every("replica", REPLICA_INTERVAL_MS, cycles.replica);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    stopping = true;
    timers.forEach(clearTimeout);
    log("worker.stopping", { signal });
    await prisma.$disconnect();
    process.exit(0);
  });
}
