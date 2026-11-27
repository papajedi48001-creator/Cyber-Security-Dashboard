"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Permission } from "@/lib/auth/authorize";
import type { ValidSession } from "@/lib/auth/service";
import { readFilesStatus } from "@/lib/backup-files/exchange";
import { evaluateFilesStatus } from "@/lib/backup-files/status";
import { getServices, newCorrelationId } from "@/lib/server/context";
import { requireActionSession } from "@/lib/server/session";

const PAGE = "/backups/files";
const field = (form: FormData, name: string) => form.get(name)?.toString().trim() ?? "";

async function run(form: FormData, permission: Permission, notice: string, work: (user: ValidSession["user"], corr: string) => Promise<unknown>) {
  const session = await requireActionSession(permission, form);
  try {
    if (form.get("confirm") !== "on") throw Object.assign(new Error("ต้องติ๊กยืนยันก่อน"), { name: "BackupFileRequestError" });
    await work(session.user, newCorrelationId());
  } catch (error) {
    if (error instanceof Error && error.name === "BackupFileRequestError") redirect(`${PAGE}?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=${encodeURIComponent(notice)}`);
}

export async function proposeDestroyAction(form: FormData) {
  await run(form, "backup.record", "ส่งคำขอแล้ว รอ Security Administrator อีกคนอนุมัติ", async (user, corr) => {
    const { config, backupFiles } = getServices();
    const status = config.gdccFiles ? await readFilesStatus(config.gdccFiles.statusPath) : null;
    await backupFiles.propose(user, { fileName: field(form, "fileName"), reason: field(form, "reason") }, evaluateFilesStatus(status, new Date()), corr);
  });
}

export async function approveDestroyAction(form: FormData) {
  await run(form, "config.manage", "อนุมัติแล้ว เริ่มช่วงพักรอก่อนทำลาย", (user, corr) =>
    getServices().backupFiles.approve(user, field(form, "id"), field(form, "note"), corr),
  );
}

export async function rejectDestroyAction(form: FormData) {
  await run(form, "config.manage", "ไม่อนุมัติคำขอแล้ว", (user, corr) => getServices().backupFiles.reject(user, field(form, "id"), field(form, "note"), corr));
}

export async function cancelDestroyAction(form: FormData) {
  await run(form, "backup.record", "ยกเลิกคำขอแล้ว ไฟล์ยังอยู่", (user, corr) => getServices().backupFiles.cancel(user, field(form, "id"), field(form, "note"), corr));
}
