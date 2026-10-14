import type { PrismaClient } from "@prisma/client";
import type { BackupStore } from "../backups/service";
import type { BackupEvidence, BackupJob, RestoreVerification } from "../backups/status";

const jobSelect = { id: true, name: true, assetName: true, expectedIntervalHours: true, destination: true } as const;

export class PrismaBackupStore implements BackupStore {
  constructor(private readonly db: PrismaClient) {}

  listJobs(): Promise<BackupJob[]> {
    return this.db.backupJob.findMany({ orderBy: { name: "asc" }, select: jobSelect });
  }
  findJobByName(name: string) {
    return this.db.backupJob.findUnique({ where: { name }, select: jobSelect });
  }
  createJob(job: Omit<BackupJob, "id">) {
    return this.db.backupJob.create({ data: job, select: jobSelect });
  }
  async addEvidence({ sizeBytes, ...evidence }: Omit<BackupEvidence, "id"> & { recordedById: string }) {
    await this.db.backupEvidence.create({ data: { ...evidence, sizeBytes: sizeBytes === null ? null : BigInt(sizeBytes) } });
  }
  async recentEvidence(jobId: string, limit: number): Promise<BackupEvidence[]> {
    const rows = await this.db.backupEvidence.findMany({
      where: { jobId },
      orderBy: { completedAt: "desc" },
      take: limit,
      select: { id: true, jobId: true, result: true, completedAt: true, sizeBytes: true, encrypted: true, retentionUntil: true },
    });
    return rows.map((r) => ({ ...r, sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes) }));
  }
  async addVerification(verification: Omit<RestoreVerification, "id">) {
    await this.db.restoreVerification.create({ data: verification });
  }
  verifications(jobId: string): Promise<RestoreVerification[]> {
    return this.db.restoreVerification.findMany({
      where: { jobId },
      orderBy: { testedAt: "desc" },
      take: 20,
      select: { id: true, jobId: true, testedAt: true, result: true, reference: true, verifiedById: true },
    });
  }
}
