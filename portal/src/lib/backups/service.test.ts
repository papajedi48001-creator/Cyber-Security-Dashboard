import { beforeEach, describe, expect, it } from "vitest";
import { createAuditLog, InMemoryAuditStore } from "../audit";
import { ForbiddenError } from "../auth/authorize";
import { BackupValidationError, BACKUP_FEATURES, createBackupService, InMemoryBackupStore } from "./service";

const NOW = new Date("2026-10-14T03:00:00Z");
const admin = { id: "admin", username: "admin", role: "SECURITY_ADMINISTRATOR" as const };
const op = { id: "op", username: "op", role: "SECURITY_OPERATOR" as const };
const exec = { id: "exec", username: "exec", role: "EXECUTIVE_VIEWER" as const };

let audit: InMemoryAuditStore;
let store: InMemoryBackupStore;
let service: ReturnType<typeof createBackupService>;

beforeEach(async () => {
  audit = new InMemoryAuditStore();
  store = new InMemoryBackupStore();
  service = createBackupService({ store, audit: createAuditLog(audit, () => NOW), clock: () => NOW });
  await service.createJob(admin, { name: "hosxp-db-nightly", assetName: "hosxp-db", expectedIntervalHours: 24, destination: "GDCC" }, "c");
});

const success = {
  jobName: "hosxp-db-nightly",
  result: "SUCCESS" as const,
  completedAt: new Date("2026-10-14T00:00:00Z"),
  sizeBytes: 5_000,
  encrypted: true,
  retentionUntil: new Date("2027-10-14T00:00:00Z"),
};

describe("backup evidence", () => {
  it("records evidence and keeps recovery unconfirmed until a restore test", async () => {
    await service.recordBackupEvidence(op, success, "c");
    const [status] = await service.listBackupStatus(op);
    expect(status).toMatchObject({ health: "ok", recovery: "unconfirmed" });
    expect(audit.records.map((r) => r.action)).toEqual(["backup.job_created", "backup.evidence_recorded"]);
  });

  it("verifies recovery only from a restore test record", async () => {
    await service.recordBackupEvidence(op, success, "c");
    await service.recordRestoreVerification(op, { jobName: "hosxp-db-nightly", testedAt: NOW, result: "PASSED", reference: "restore-2026-10.pdf" }, "c");
    expect((await service.listBackupStatus(op))[0]!.recovery).toBe("verified");
  });

  it("rejects evidence for unknown jobs, future times and missing fields", async () => {
    await expect(service.recordBackupEvidence(op, { ...success, jobName: "nope" }, "c")).rejects.toBeInstanceOf(BackupValidationError);
    await expect(service.recordBackupEvidence(op, { ...success, completedAt: new Date("2026-10-15T00:00:00Z") }, "c")).rejects.toBeInstanceOf(
      BackupValidationError,
    );
    await expect(
      service.recordRestoreVerification(op, { jobName: "hosxp-db-nightly", testedAt: NOW, result: "PASSED", reference: " " }, "c"),
    ).rejects.toBeInstanceOf(BackupValidationError);
  });

  it("imports a CSV backup report and reports bad lines without storing them", async () => {
    const result = await service.importBackupReport(
      op,
      [
        "job,result,completed_at,size_bytes,encrypted,retention_until",
        "hosxp-db-nightly,SUCCESS,2026-10-13T00:00:00Z,4000,yes,2027-10-13",
        "hosxp-db-nightly,FAILED,2026-10-14T00:00:00Z,,yes,",
        "unknown-job,SUCCESS,2026-10-14T00:00:00Z,1,yes,",
        "hosxp-db-nightly,MAYBE,2026-10-14T00:00:00Z,1,yes,",
      ].join("\n"),
      "c",
    );
    expect(result).toMatchObject({ imported: 2, rejected: [{ line: 4 }, { line: 5 }] });
    expect((await service.listBackupStatus(op))[0]).toMatchObject({ health: "failing", consecutiveFailures: 1 });
  });

  it("gives executives counts only", async () => {
    await service.recordBackupEvidence(op, success, "c");
    expect(await service.backupSummary(exec)).toEqual({ jobs: 1, ok: 1, needsAttention: 0, recoveryVerified: 0 });
  });

  it("restricts roles and offers no restore or delete operation", async () => {
    await expect(service.listBackupStatus(exec)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.recordBackupEvidence(exec, success, "c")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.createJob(op, { name: "x", assetName: null, expectedIntervalHours: 24, destination: "GDCC" }, "c")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(Object.keys(service).filter((k) => /restore(?!Verification)|delete|destroy|run/i.test(k))).toEqual([]);
    expect(BACKUP_FEATURES.lifecycleRequests).toBe(false);
  });
});
