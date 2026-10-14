"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MFA_CHALLENGE_COOKIE } from "@/lib/auth/provider-id";
import { getServices, newCorrelationId } from "@/lib/server/context";
import { requestIp, setSessionCookie } from "@/lib/server/session";

export interface MfaState {
  error?: string;
}

export async function completeMfaAction(_state: MfaState, form: FormData): Promise<MfaState> {
  const jar = await cookies();
  const challenge = jar.get(MFA_CHALLENGE_COOKIE)?.value;
  jar.delete({ name: MFA_CHALLENGE_COOKIE, path: "/", secure: true });
  const result = await getServices().auth.completeMfaChallenge(challenge, form.get("totp")?.toString() ?? "", {
    ip: await requestIp(),
    correlationId: newCorrelationId(),
  });
  if (!result.ok) redirect("/login?provider_id=mfa_failed");
  await setSessionCookie(result.token);
  redirect("/");
}
