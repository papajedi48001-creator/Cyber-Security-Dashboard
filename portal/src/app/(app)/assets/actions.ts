"use server";

import { revalidatePath } from "next/cache";
import { getServices, newCorrelationId } from "@/lib/server/context";
import { requireActionSession } from "@/lib/server/session";

export interface AssetFormState {
  error?: string;
  ok?: boolean;
}

export async function saveAssetAction(_state: AssetFormState, form: FormData): Promise<AssetFormState> {
  const session = await requireActionSession("asset.write", form);
  const id = form.get("id")?.toString();
  const input = {
    name: form.get("name")?.toString() ?? "",
    role: form.get("role")?.toString() ?? "",
    owner: form.get("owner")?.toString() ?? "",
    critical: form.get("critical") === "on",
    criticalReason: form.get("criticalReason")?.toString() ?? "",
  };
  try {
    const { assets } = getServices();
    if (id) await assets.updateAsset(session.user, id, input, newCorrelationId());
    else await assets.createAsset(session.user, input, newCorrelationId());
    revalidatePath("/assets");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "บันทึกไม่สำเร็จ" };
  }
}
