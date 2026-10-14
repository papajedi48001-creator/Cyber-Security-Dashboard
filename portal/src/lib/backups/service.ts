// Read-only Backup Evidence: the Portal records what the backup system reports
// and separate restore tests. It never runs, restores or deletes backups
// (spec "Backup and disaster recovery"); lifecycle requests stay disabled.

import type { AuditLog } from "../audit";
import { requirePermission, type Principal } from "../auth/authorize";
import { evaluateBackupJob, type BackupEvidence, type BackupJob, type RestoreVerification } from "./status";

/** Future Backup File Management (Phase 4) stays off until separately approved. */
export const BACKUP_FEATURES = { lifecycleRequests: false } as const;

export interface BackupStore {
  listJobs(): Promise<BackupJob[]>;
  findJobByName(name: string): Promise<BackupJob | null>;
  createJob(job: Omit<BackupJob, "id">): Promise<BackupJob>;
  addEvidence(evidence: Omit<BackupEvidence, "id"> & { recordedById: string }): Promise<void>;
  /** Most recent evidence per job, newest first. */
  recentEvidence(jobId: string, limit: number): Promise<BackupEvidence[]>;
  addVerification(verification: Omit<RestoreVerification, "id">): Promise<void>;
  verifications(jobId: string): Promise<RestoreVerification[]>;
}

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}

type Actor = Principal & { username: string };

export interface EvidenceInput {
  jobName: string;
  result: "SUCCESS" | "FAILED";
  completedAt: Date;
  sizeBytes: number | null;
  encrypted: boolean;
  retentionUntil: Date | null;
}

const NAME = /^[A-Za-z0-9._-]{1,128}$/;
const NATIONAL_ID = /(?<!\d)\d{13}(?!\d)/;
const EVIDENCE_WINDOW = 50;

function validDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new BackupValidationError(`${field} ไม่ถูกต้อง`);
  return value;
}

export function createBackupService({ store, audit, clock = () => new Date() }: { store: BackupStore; audit: AuditLog; clock?: () => Date }) {
  const record = (actor: Actor, action: string, job: BackupJob, correlationId: string, metadata?: Record<string, unknown>) =>
    audit.append({
      actor: { id: actor.id, label: actor.username },
      action,
      target: { type: "BackupJob", id: job.id },
      metadata: { job: job.name, ...metadata },
      correlationId,
    });

  async function job(name: string): Promise<BackupJob> {
    const found = await store.findJobByName(name.trim());
    if (!found) throw new BackupValidationError(`ไม่พบงาน backup "${name.slice(0, 64)}"`);
    return found;
  }

  async function addEvidence(actor: Actor, input: EvidenceInput, correlationId: string) {
    const target = await job(input.jobName);
    if (input.result !== "SUCCESS" && input.result !== "FAILED") throw new BackupValidationError("ผลต้องเป็น SUCCESS หรือ FAILED");
    const completedAt = validDate(input.completedAt, "เวลาที่เสร็จ");
    if (completedAt > clock()) throw new BackupValidationError("เวลาที่เสร็จต้องไม่อยู่ในอนาคต");
    if (input.sizeBytes !== null && (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0))
      throw new BackupValidationError("ขนาดไม่ถูกต้อง");
    if (input.retentionUntil) validDate(input.retentionUntil, "วันหมดอายุการเก็บ");
    await store.addEvidence({
      jobId: target.id,
      result: input.result,
      completedAt,
      sizeBytes: input.sizeBytes,
      encrypted: input.encrypted,
      retentionUntil: input.retentionUntil,
      recordedById: actor.id,
    });
    return target;
  }

  const service = {
    async listBackupStatus(actor: Principal) {
      requirePermission(actor, "evidence.read");
      const now = clock();
      const jobs = await store.listJobs();
      return Promise.all(
        jobs.map(async (j) => evaluateBackupJob(j, await store.recentEvidence(j.id, EVIDENCE_WINDOW), await store.verifications(j.id), now)),
      );
    },

    /** Counts only, for the executive summary. */
    async backupSummary(actor: Principal) {
      requirePermission(actor, "executive.read");
      const now = clock();
      const jobs = await store.listJobs();
      const statuses = await Promise.all(
        jobs.map(async (j) => evaluateBackupJob(j, await store.recentEvidence(j.id, EVIDENCE_WINDOW), await store.verifications(j.id), now)),
      );
      return {
        jobs: statuses.length,
        ok: statuses.filter((s) => s.health === "ok").length,
        needsAttention: statuses.filter((s) => s.health !== "ok").length,
        recoveryVerified: statuses.filter((s) => s.recovery === "verified").length,
      };
    },

    async createJob(actor: Actor, input: Omit<BackupJob, "id">, correlationId: string) {
      requirePermission(actor, "config.manage");
      const name = input.name.trim();
      if (!NAME.test(name)) throw new BackupValidationError("ชื่องานใช้ได้เฉพาะ A-Z a-z 0-9 . _ -");
      if (!Number.isInteger(input.expectedIntervalHours) || input.expectedIntervalHours < 1 || input.expectedIntervalHours > 24 * 31)
        throw new BackupValidationError("รอบการสำรองต้องเป็นจำนวนชั่วโมง 1–744");
      const destination = input.destination.trim();
      if (!destination || destination.length > 128 || NATIONAL_ID.test(destination)) throw new BackupValidationError("ปลายทางไม่ถูกต้อง");
      if (await store.findJobByName(name)) throw new BackupValidationError("มีงาน backup ชื่อนี้แล้ว");
      const created = await store.createJob({ name, assetName: input.assetName?.trim() || null, expectedIntervalHours: input.expectedIntervalHours, destination });
      await record(actor, "backup.job_created", created, correlationId);
      return created;
    },

    async recordBackupEvidence(actor: Actor, input: EvidenceInput, correlationId: string) {
      requirePermission(actor, "backup.record");
      const target = await addEvidence(actor, input, correlationId);
      await record(actor, "backup.evidence_recorded", target, correlationId, { result: input.result, encrypted: input.encrypted });
    },

    async recordRestoreVerification(
      actor: Actor,
      input: { jobName: string; testedAt: Date; result: "PASSED" | "FAILED"; reference: string },
      correlationId: string,
    ) {
      requirePermission(actor, "backup.record");
      const target = await job(input.jobName);
      const testedAt = validDate(input.testedAt, "เวลาที่ทดสอบ");
      if (testedAt > clock()) throw new BackupValidationError("เวลาที่ทดสอบต้องไม่อยู่ในอนาคต");
      if (input.result !== "PASSED" && input.result !== "FAILED") throw new BackupValidationError("ผลต้องเป็น PASSED หรือ FAILED");
      const reference = input.reference.trim();
      if (!reference || reference.length > 500 || NATIONAL_ID.test(reference))
        throw new BackupValidationError("ต้องระบุอ้างอิงหลักฐานการทดสอบกู้คืน");
      await store.addVerification({ jobId: target.id, testedAt, result: input.result, reference, verifiedById: actor.id });
      await record(actor, "backup.restore_verified", target, correlationId, { result: input.result });
    },

    /**
     * CSV exported from the backup system:
     * job,result,completed_at,size_bytes,encrypted,retention_until (header optional).
     */
    async importBackupReport(actor: Actor, csv: string, correlationId: string) {
      requirePermission(actor, "backup.record");
      const rejected: { line: number; reason: string }[] = [];
      let imported = 0;
      const lines = csv.split(/\r?\n/);
      if (lines.length > 2000) throw new BackupValidationError("ไฟล์ยาวเกิน 2000 บรรทัด");
      for (const [index, raw] of lines.entries()) {
        const line = raw.trim();
        if (!line || (index === 0 && /^job\s*,/i.test(line))) continue;
        const [jobName = "", result = "", completed = "", size = "", encrypted = "", retention = ""] = line.split(",").map((c) => c.trim());
        try {
          if (!/^(yes|no|true|false)$/i.test(encrypted)) throw new BackupValidationError("encrypted ต้องเป็น yes หรือ no");
          await addEvidence(
            actor,
            {
              jobName,
              result: result.toUpperCase() as EvidenceInput["result"],
              completedAt: new Date(completed),
              sizeBytes: size ? Number(size) : null,
              encrypted: /^(yes|true)$/i.test(encrypted),
              retentionUntil: retention ? new Date(retention) : null,
            },
            correlationId,
          );
          imported++;
        } catch (error) {
          if (!(error instanceof BackupValidationError)) throw error;
          rejected.push({ line: index + 1, reason: error.message });
        }
      }
      await audit.append({
        actor: { id: actor.id, label: actor.username },
        action: "backup.report_imported",
        target: { type: "BackupReport" },
        metadata: { imported, rejected: rejected.length },
        correlationId,
      });
      return { imported, rejected };
    },
  };
  return service;
}

export type BackupService = ReturnType<typeof createBackupService>;

/** Test and development store. */
export class InMemoryBackupStore implements BackupStore {
  readonly jobs: BackupJob[] = [];
  readonly evidence: (BackupEvidence & { recordedById: string })[] = [];
  readonly verificationRows: RestoreVerification[] = [];

  async listJobs() {
    return [...this.jobs].sort((a, b) => a.name.localeCompare(b.name));
  }
  async findJobByName(name: string) {
    return this.jobs.find((j) => j.name === name) ?? null;
  }
  async createJob(job: Omit<BackupJob, "id">) {
    const created = { ...job, id: `job-${this.jobs.length + 1}` };
    this.jobs.push(created);
    return created;
  }
  async addEvidence(evidence: Omit<BackupEvidence, "id"> & { recordedById: string }) {
    this.evidence.push({ ...evidence, id: `ev-${this.evidence.length + 1}` });
  }
  async recentEvidence(jobId: string, limit: number) {
    return this.evidence
      .filter((e) => e.jobId === jobId)
      .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
      .slice(0, limit);
  }
  async addVerification(verification: Omit<RestoreVerification, "id">) {
    this.verificationRows.push({ ...verification, id: `rv-${this.verificationRows.length + 1}` });
  }
  async verifications(jobId: string) {
    return this.verificationRows.filter((v) => v.jobId === jobId);
  }
}
