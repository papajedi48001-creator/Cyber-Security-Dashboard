"use server";

import { redirect } from "next/navigation";
import { getServices, newCorrelationId } from "@/lib/server/context";
import { requestIp, setSessionCookie } from "@/lib/server/session";

export interface LoginState {
  error?: string;
}

export async function loginAction(_state: LoginState, form: FormData): Promise<LoginState> {
  const result = await getServices().auth.authenticate(
    {
      username: form.get("username")?.toString() ?? "",
      password: form.get("password")?.toString() ?? "",
      totpCode: form.get("totp")?.toString() ?? "",
    },
    { ip: await requestIp(), correlationId: newCorrelationId() },
  );
  if (!result.ok) return { error: "ชื่อผู้ใช้ รหัสผ่าน หรือรหัส MFA ไม่ถูกต้อง หรือบัญชีถูกล็อกชั่วคราว" };
  await setSessionCookie(result.token);
  redirect("/");
}
