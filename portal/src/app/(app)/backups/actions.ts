"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Permission } from "@/lib/auth/authorize";
import type { ValidSession } from "@/lib/auth/service";
import { getServices, newCorrelationId } from "@/lib/server/context";
import { requireActionSession } from "@/lib/server/session";

const field = (form: FormData, name: string) => form.get(name)?.toString().trim() ?? "";
/** datetime-local inputs are Bangkok time. */
const bangkok = (value: string) => new Date(value ? `${value}:00+07:00` : "invalid");

async function run(form: FormData, permission: Permission, work: (user: ValidSession["user"], corr: string) => Promise<string | void>) {
  const session = await requireActionSession(permission, form);
  let notice = "";
  try {
    notice = (await work(session.user, newCorrelationId())) ?? "บันทึกแล้ว";
  } catch (error) {
    if (error instanceof Error && error.name === "BackupValidationError") redirect(`/backups?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  revalidatePath("/backups");
  redirect(`/backups?notice=${encodeURIComponent(notice)}`);
}

export async function recordEvidenceAction(form: FormData) {
  await run(form, "backup.record", async (user, corr) => {
    const size = field(form, "sizeGb");
    const retention = field(form, "retentionUntil");
    await getServices().backups.recordBackupEvidence(
      user,
      {
        jobName: field(form, "jobName"),
        result: field(form, "result") as "SUCCESS" | "FAILED",
        completedAt: bangkok(field(form, "completedAt")),
        sizeBytes: size ? Math.round(Number(size) * 1024 ** 3) : null,
        encrypted: form.get("encrypted") === "on",
        retentionUntil: retention ? new Date(`${retention}T00:00:00+07:00`) : null,
      },
      corr,
    );
  });
}

export async function recordVerificationAction(form: FormData) {
  await run(form, "backup.record", async (user, corr) => {
    await getServices().backups.recordRestoreVerification(
      user,
      {
        jobName: field(form, "jobName"),
        testedAt: bangkok(field(form, "testedAt")),
        result: field(form, "result") as "PASSED" | "FAILED",
        reference: field(form, "reference"),
      },
      corr,
    );
  });
}

export async function importReportAction(form: FormData) {
  await run(form, "backup.record", async (user, corr) => {
    const { imported, rejected } = await getServices().backups.importBackupReport(user, form.get("csv")?.toString() ?? "", corr);
    const bad = rejected.slice(0, 5).map((r) => `บรรทัด ${r.line}: ${r.reason}`).join("; ");
    return `นำเข้า ${imported} รายการ${rejected.length ? `, ไม่ผ่าน ${rejected.length} รายการ (${bad})` : ""}`;
  });
}

export async function createJobAction(form: FormData) {
  await run(form, "config.manage", async (user, corr) => {
    await getServices().backups.createJob(
      user,
      {
        name: field(form, "name"),
        assetName: field(form, "assetName") || null,
        expectedIntervalHours: Number(field(form, "expectedIntervalHours")),
        destination: field(form, "destination"),
      },
      corr,
    );
  });
}
