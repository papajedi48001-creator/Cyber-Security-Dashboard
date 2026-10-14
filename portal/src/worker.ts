// Portal background worker: run beside the web process (`npm run worker`).
// Polls Wazuh, opens incidents, watches source health and port exposure, and
// sends notifications.

import { randomUUID } from "node:crypto";
import { prisma } from "./lib/db/client";
import { PrismaIntakeStore } from "./lib/db/intake-store";
import { getServices } from "./lib/server/context";
import { silentSources } from "./lib/sources";
import { createIndexerClient, httpsTransport } from "./lib/wazuh/client";
import { pollWazuhAlerts } from "./lib/wazuh/poller";
import { createWorkerCycles } from "./lib/worker/cycles";

const NOTIFY_INTERVAL_MS = 30_000;
const SOURCE_HEALTH_INTERVAL_MS = 60_000;
const PORT_INTERVAL_MS = 5 * 60_000;

const log = (event: string, detail: Record<string, unknown>) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...detail }));

const { config, audit, incidents, notifier, ports } = getServices();
const source = createIndexerClient({
  baseUrl: config.wazuh.indexerUrl,
  username: config.wazuh.username,
  password: config.wazuh.password,
  transport: httpsTransport(config.wazuh.caCertPath),
});
const intakeStore = new PrismaIntakeStore(prisma);

const cycles = createWorkerCycles({
  poll: () => pollWazuhAlerts({ source, store: intakeStore, audit, dashboardUrl: config.wazuh.dashboardUrl }),
  incidents,
  notifier,
  silentSources: () => silentSources(prisma, config.wazuh.pollIntervalSeconds),
  portFindings: ports.findingsForIncidents,
  log,
  newCorrelationId: randomUUID,
});

let stopping = false;
const timers = new Map<string, NodeJS.Timeout>();

/** Runs a cycle, then waits the full interval before the next one, so runs never overlap. */
function every(name: string, intervalMs: number, cycle: () => Promise<void>) {
  const run = async () => {
    await cycle();
    if (!stopping) timers.set(name, setTimeout(run, intervalMs));
  };
  void run();
}

if (notifier.channelsConfigured.length === 0) log("notifications.unconfigured", { message: "no Email or LINE channel configured" });
log("worker.started", { pollIntervalSeconds: config.wazuh.pollIntervalSeconds, channels: notifier.channelsConfigured });
every("intake", config.wazuh.pollIntervalSeconds * 1000, cycles.intake);
every("source_health", SOURCE_HEALTH_INTERVAL_MS, cycles.sourceHealth);
every("ports", PORT_INTERVAL_MS, cycles.ports);
every("notifications", NOTIFY_INTERVAL_MS, cycles.notifications);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    stopping = true;
    timers.forEach(clearTimeout);
    log("worker.stopping", { signal });
    await prisma.$disconnect();
    process.exit(0);
  });
}
