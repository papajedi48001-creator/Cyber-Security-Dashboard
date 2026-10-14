"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Permission } from "@/lib/auth/authorize";
import type { ValidSession } from "@/lib/auth/service";
import type { PortFamily, Protocol } from "@/lib/port-monitor/policy";
import { getServices, newCorrelationId } from "@/lib/server/context";
import { requireActionSession } from "@/lib/server/session";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const field = (form: FormData, name: string) => form.get(name)?.toString().trim() ?? "";

async function text(form: FormData, fileField: string, textField: string): Promise<string> {
  const file = form.get(fileField);
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) throw Object.assign(new Error("ไฟล์ใหญ่เกิน 2 MB"), { name: "PortPolicyError" });
    return file.text();
  }
  return form.get(textField)?.toString() ?? "";
}

async function run(form: FormData, permission: Permission, work: (user: ValidSession["user"], corr: string) => Promise<void>) {
  const session = await requireActionSession(permission, form);
  try {
    await work(session.user, newCorrelationId());
  } catch (error) {
    if (error instanceof Error && error.name === "PortPolicyError") redirect(`/port-monitor?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  revalidatePath("/port-monitor");
  redirect(`/port-monitor?notice=${encodeURIComponent("บันทึกแล้ว")}`);
}

export async function importScanAction(form: FormData) {
  await run(form, "backup.record", async (user, corr) => {
    await getServices().ports.importExposureScan(user, await text(form, "file", "json"), corr);
  });
}

export async function importFirewallAction(form: FormData) {
  await run(form, "backup.record", async (user, corr) => {
    await getServices().ports.importFirewallRules(user, await text(form, "file", "csv"), corr);
  });
}

export async function addExceptionAction(form: FormData) {
  await run(form, "config.manage", async (user, corr) => {
    const expires = field(form, "expiresAt");
    await getServices().ports.addException(
      user,
      {
        family: field(form, "family") as PortFamily,
        address: field(form, "address") || null,
        port: Number(field(form, "port")),
        protocol: field(form, "protocol") as Protocol,
        reason: field(form, "reason"),
        owner: field(form, "owner"),
        expiresAt: new Date(expires ? `${expires}T23:59:59+07:00` : "invalid"),
      },
      corr,
    );
  });
}

export async function revokeExceptionAction(form: FormData) {
  await run(form, "config.manage", async (user, corr) => {
    await getServices().ports.revokeException(user, field(form, "id"), corr);
  });
}
