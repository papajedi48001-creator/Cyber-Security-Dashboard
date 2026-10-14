import type { PrismaClient } from "@prisma/client";
import type { PortException, Protocol } from "../port-monitor/policy";
import type { ExposureScan, FirewallExposureRule } from "../port-monitor/scan-import";
import type { PortStore, StoredScan } from "../port-monitor/service";

type StoredFinding = ExposureScan["findings"][number];

const toException = (row: Omit<PortException, "protocol"> & { protocol: string }): PortException => ({
  ...row,
  protocol: row.protocol as Protocol,
});

export class PrismaPortStore implements PortStore {
  constructor(private readonly db: PrismaClient) {}

  async saveScan(scan: ExposureScan, importedById: string): Promise<StoredScan> {
    const row = await this.db.portScan.create({
      data: { ...scan, targets: scan.targets, findings: scan.findings, importedById },
    });
    return { ...scan, id: row.id, importedAt: row.importedAt };
  }

  async latestScan(): Promise<StoredScan | null> {
    const row = await this.db.portScan.findFirst({ orderBy: { finishedAt: "desc" } });
    if (!row) return null;
    return {
      id: row.id,
      scanner: row.scanner,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      importedAt: row.importedAt,
      targets: row.targets as string[],
      findings: row.findings as unknown as StoredFinding[],
    };
  }

  async saveFirewallRules(rules: FirewallExposureRule[], importedById: string) {
    const row = await this.db.firewallExposureSnapshot.create({ data: { rules: rules as object[], importedById } });
    return { id: row.id, importedAt: row.importedAt };
  }

  async latestFirewallRules() {
    const row = await this.db.firewallExposureSnapshot.findFirst({ orderBy: { importedAt: "desc" } });
    return row ? { importedAt: row.importedAt, rules: row.rules as unknown as FirewallExposureRule[] } : null;
  }

  async listExceptions() {
    const rows = await this.db.portException.findMany({ orderBy: [{ revokedAt: "asc" }, { expiresAt: "asc" }], take: 500 });
    return rows.map(toException);
  }

  async addException(exception: Omit<PortException, "id" | "revokedAt">) {
    return toException(await this.db.portException.create({ data: exception }));
  }

  async revokeException(id: string, at: Date) {
    const { count } = await this.db.portException.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at } });
    if (count === 0) return null;
    const row = await this.db.portException.findUnique({ where: { id } });
    return row ? toException(row) : null;
  }

  recentEgress(since: Date) {
    return this.db.alertReference.findMany({
      where: { category: "restricted_egress", detectedAt: { gte: since } },
      orderBy: { detectedAt: "desc" },
      take: 1000,
      select: { wazuhAlertId: true, detectedAt: true, description: true, investigationUrl: true },
    });
  }
}
