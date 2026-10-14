"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@/lib/auth/authorize";
import { PROVIDER_ID_ISSUER } from "@/lib/auth/service";
import { getServices, newCorrelationId } from "@/lib/server/context";
import { requireActionSession } from "@/lib/server/session";

export interface EnrollmentState {
  error?: string;
  username?: string;
  otpauthUri?: string;
}

const ROLES: Role[] = ["SECURITY_ADMINISTRATOR", "SECURITY_OPERATOR", "EXECUTIVE_VIEWER"];

export async function createUserAction(_state: EnrollmentState, form: FormData): Promise<EnrollmentState> {
  const session = await requireActionSession("user.manage", form);
  const role = form.get("role")?.toString() as Role;
  if (!ROLES.includes(role)) return { error: "บทบาทไม่ถูกต้อง" };
  try {
    const enrollment = await getServices().auth.createUser({
      actor: session.user,
      username: form.get("username")?.toString() ?? "",
      displayName: form.get("displayName")?.toString() ?? "",
      role,
      password: form.get("password")?.toString() ?? "",
      correlationId: newCorrelationId(),
    });
    revalidatePath("/admin/users");
    return { username: enrollment.user.username, otpauthUri: enrollment.otpauthUri };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "สร้างผู้ใช้ไม่สำเร็จ" };
  }
}

export async function resetMfaAction(_state: EnrollmentState, form: FormData): Promise<EnrollmentState> {
  const session = await requireActionSession("user.manage", form);
  try {
    const enrollment = await getServices().auth.resetMfa({
      actor: session.user,
      userId: form.get("userId")?.toString() ?? "",
      correlationId: newCorrelationId(),
    });
    return { username: enrollment.user.username, otpauthUri: enrollment.otpauthUri };
  } catch {
    return { error: "รีเซ็ต MFA ไม่สำเร็จ (ไม่สามารถรีเซ็ตของตัวเองได้)" };
  }
}

export async function setActiveAction(form: FormData): Promise<void> {
  const session = await requireActionSession("user.manage", form);
  await getServices().auth.setActive({
    actor: session.user,
    userId: form.get("userId")?.toString() ?? "",
    active: form.get("active") === "true",
    correlationId: newCorrelationId(),
  });
  revalidatePath("/admin/users");
}

export interface LinkState {
  error?: string;
}

export async function linkProviderIdAction(_state: LinkState, form: FormData): Promise<LinkState> {
  const session = await requireActionSession("user.manage", form);
  try {
    await getServices().auth.linkExternalIdentity({
      actor: session.user,
      userId: form.get("userId")?.toString() ?? "",
      issuer: PROVIDER_ID_ISSUER,
      subject: form.get("providerId")?.toString() ?? "",
      correlationId: newCorrelationId(),
    });
  } catch (error) {
    return { error: error instanceof Error && error.message ? error.message : "ผูก Provider ID ไม่สำเร็จ" };
  }
  revalidatePath("/admin/users");
  return {};
}

export async function unlinkProviderIdAction(form: FormData): Promise<void> {
  const session = await requireActionSession("user.manage", form);
  await getServices().auth.unlinkExternalIdentity({
    actor: session.user,
    userId: form.get("userId")?.toString() ?? "",
    issuer: PROVIDER_ID_ISSUER,
    correlationId: newCorrelationId(),
  });
  revalidatePath("/admin/users");
}
