"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServices, newCorrelationId } from "@/lib/server/context";
import { requireActionSession } from "@/lib/server/session";

const count = (form: FormData, name: string) => {
  const value = form.get(name)?.toString().trim() ?? "";
  return value === "" ? Number.NaN : Number(value);
};

export async function recordDuoCheckAction(form: FormData) {
  const session = await requireActionSession("incident.write", form);
  const checked = form.get("checkedAt")?.toString() ?? "";
  try {
    await getServices().duo.recordDuoManualCheck(
      session.user,
      {
        checkedAt: new Date(checked ? `${checked}:00+07:00` : "invalid"),
        authLogReviewed: form.get("authLogReviewed") === "on",
        adminActionsReviewed: form.get("adminActionsReviewed") === "on",
        deniedAuthentications: count(form, "deniedAuthentications"),
        fraudReports: count(form, "fraudReports"),
        bypassUsers: count(form, "bypassUsers"),
        note: form.get("note")?.toString() ?? null,
      },
      newCorrelationId(),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "DuoCheckError") redirect(`/duo?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  revalidatePath("/duo");
  redirect(`/duo?notice=${encodeURIComponent("บันทึกแล้ว")}`);
}
