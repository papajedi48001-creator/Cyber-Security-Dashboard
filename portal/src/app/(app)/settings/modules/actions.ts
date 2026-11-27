"use server";

import { revalidatePath } from "next/cache";
import { getServices, newCorrelationId } from "@/lib/server/context";
import { requireActionSession } from "@/lib/server/session";

export async function setModuleEnabledAction(form: FormData) {
  const session = await requireActionSession("config.manage", form);
  const id = form.get("moduleId")?.toString() ?? "";
  const enabled = form.get("enabled")?.toString() === "true";
  await getServices().modules.setEnabled(session.user, id, enabled, newCorrelationId());
  revalidatePath("/", "layout");
}
