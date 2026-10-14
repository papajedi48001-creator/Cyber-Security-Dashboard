import { describe, expect, it } from "vitest";
import { backupVerificationStatus, evaluateBackupJob, type BackupEvidence, type BackupJob, type RestoreVerification } from "./status";

const NOW = new Date("2026-10-14T03:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const job: BackupJob = { id: "j1", name: "hosxp-db-nightly", assetName: "hosxp-db", expectedIntervalHours: 24, destination: "GDCC" };

const evidence = (overrides: Partial<BackupEvidence>): BackupEvidence => ({
  id: "e",
  jobId: "j1",
  result: "SUCCESS",
  completedAt: hoursAgo(5),
  sizeBytes: 10_000_000_000,
  encrypted: true,
  retentionUntil: new Date("2027-10-14T00:00:00Z"),
  ...overrides,
});

const verification = (overrides: Partial<RestoreVerification>): RestoreVerification => ({
  id: "v",
  jobId: "j1",
  testedAt: hoursAgo(24 * 10),
  result: "PASSED",
  reference: "restore-test-2026-10.pdf",
  verifiedById: "admin",
  ...overrides,
});

describe("evaluateBackupJob", () => {
  it("reports a recent encrypted success as ok but recovery as unconfirmed without a restore test", () => {
    const status = evaluateBackupJob(job, [evidence({})], [], NOW);
    expect(status).toMatchObject({ health: "ok", lastResult: "SUCCESS", dataAgeHours: 5, consecutiveFailures: 0, encrypted: true });
    expect(status.recovery).toBe("unconfirmed");
  });

  it("counts consecutive failures since the last success", () => {
    const status = evaluateBackupJob(
      job,
      [evidence({ completedAt: hoursAgo(50) }), evidence({ result: "FAILED", completedAt: hoursAgo(26) }), evidence({ result: "FAILED", completedAt: hoursAgo(2) })],
      [],
      NOW,
    );
    expect(status).toMatchObject({ health: "failing", consecutiveFailures: 2, lastResult: "FAILED", dataAgeHours: 50 });
  });

  it("marks a job stale when the last success is older than its interval allows", () => {
    expect(evaluateBackupJob(job, [evidence({ completedAt: hoursAgo(40) })], [], NOW).health).toBe("stale");
  });

  it("never reports health for a job with no evidence", () => {
    expect(evaluateBackupJob(job, [], [], NOW)).toMatchObject({ health: "unknown", lastResult: null, dataAgeHours: null });
  });

  it("flags an unencrypted backup", () => {
    expect(evaluateBackupJob(job, [evidence({ encrypted: false })], [], NOW).health).toBe("unencrypted");
  });
});

describe("backupVerificationStatus", () => {
  it("is verified only by a separate passed restore test within the validity window", () => {
    expect(backupVerificationStatus([verification({})], NOW)).toBe("verified");
    expect(backupVerificationStatus([verification({ result: "FAILED" })], NOW)).toBe("unconfirmed");
    expect(backupVerificationStatus([verification({ testedAt: hoursAgo(24 * 200) })], NOW)).toBe("unconfirmed");
    expect(backupVerificationStatus([], NOW)).toBe("unconfirmed");
  });

  it("lets the latest test decide", () => {
    expect(
      backupVerificationStatus([verification({ testedAt: hoursAgo(48) }), verification({ result: "FAILED", testedAt: hoursAgo(1) })], NOW),
    ).toBe("unconfirmed");
  });
});
