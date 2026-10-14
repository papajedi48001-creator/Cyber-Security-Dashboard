// Backup Evidence (spec "Backup and disaster recovery"). A successful backup job
// is not proof of recovery: only a separate, passed restore test marks a job
// verified, and that verification expires.

export interface BackupJob {
  id: string;
  name: string;
  assetName: string | null;
  expectedIntervalHours: number;
  destination: string;
}

export interface BackupEvidence {
  id: string;
  jobId: string;
  result: "SUCCESS" | "FAILED";
  completedAt: Date;
  sizeBytes: number | null;
  encrypted: boolean;
  retentionUntil: Date | null;
}

export interface RestoreVerification {
  id: string;
  jobId: string;
  testedAt: Date;
  result: "PASSED" | "FAILED";
  reference: string;
  verifiedById: string;
}

export type BackupHealth = "ok" | "failing" | "stale" | "unencrypted" | "unknown";
export type RecoveryStatus = "verified" | "unconfirmed";

/** A restore test older than this no longer counts as verification. */
export const VERIFICATION_VALID_DAYS = 90;
/** Grace before a missed schedule counts as stale. */
const STALE_FACTOR = 1.5;
const HOUR = 3_600_000;

export function backupVerificationStatus(verifications: RestoreVerification[], now: Date): RecoveryStatus {
  const latest = [...verifications].sort((a, b) => b.testedAt.getTime() - a.testedAt.getTime())[0];
  if (!latest || latest.result !== "PASSED") return "unconfirmed";
  return now.getTime() - latest.testedAt.getTime() <= VERIFICATION_VALID_DAYS * 24 * HOUR ? "verified" : "unconfirmed";
}

export interface BackupJobStatus {
  job: BackupJob;
  health: BackupHealth;
  lastResult: "SUCCESS" | "FAILED" | null;
  lastCompletedAt: Date | null;
  lastSuccessAt: Date | null;
  dataAgeHours: number | null;
  consecutiveFailures: number;
  sizeBytes: number | null;
  encrypted: boolean | null;
  retentionUntil: Date | null;
  recovery: RecoveryStatus;
  lastVerification: RestoreVerification | null;
}

export function evaluateBackupJob(
  job: BackupJob,
  evidence: BackupEvidence[],
  verifications: RestoreVerification[],
  now: Date,
): BackupJobStatus {
  const ordered = [...evidence].sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
  const latest = ordered[0] ?? null;
  const lastSuccess = ordered.find((e) => e.result === "SUCCESS") ?? null;
  const failuresIndex = ordered.findIndex((e) => e.result === "SUCCESS");
  const consecutiveFailures = failuresIndex === -1 ? ordered.length : failuresIndex;
  const dataAgeHours = lastSuccess ? Math.floor((now.getTime() - lastSuccess.completedAt.getTime()) / HOUR) : null;

  let health: BackupHealth;
  if (!latest) health = "unknown";
  else if (latest.result === "FAILED") health = "failing";
  else if (dataAgeHours! > job.expectedIntervalHours * STALE_FACTOR) health = "stale";
  else if (!lastSuccess!.encrypted) health = "unencrypted";
  else health = "ok";

  const lastVerification = [...verifications].sort((a, b) => b.testedAt.getTime() - a.testedAt.getTime())[0] ?? null;
  return {
    job,
    health,
    lastResult: latest?.result ?? null,
    lastCompletedAt: latest?.completedAt ?? null,
    lastSuccessAt: lastSuccess?.completedAt ?? null,
    dataAgeHours,
    consecutiveFailures,
    sizeBytes: lastSuccess?.sizeBytes ?? null,
    encrypted: lastSuccess?.encrypted ?? null,
    retentionUntil: lastSuccess?.retentionUntil ?? null,
    recovery: backupVerificationStatus(verifications, now),
    lastVerification,
  };
}
