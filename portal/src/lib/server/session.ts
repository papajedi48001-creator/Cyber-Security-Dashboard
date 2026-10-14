import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, type Permission } from "../auth/authorize";
import { SESSION_COOKIE } from "../auth/gate";
import { clientIp } from "../auth/network";
import type { ValidSession } from "../auth/service";
import { getServices } from "./context";

export async function currentSession(): Promise<ValidSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getServices().auth.validateSession(token);
}

/** For pages: redirect to login when signed out, to /forbidden without the permission. */
export async function requirePageSession(permission: Permission): Promise<ValidSession> {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!can(session.user, permission)) redirect("/forbidden");
  return session;
}

/** For server actions: also checks the session-bound CSRF token from the form. */
export async function requireActionSession(permission: Permission, form: FormData): Promise<ValidSession> {
  const session = await requirePageSession(permission);
  if (!getServices().auth.verifyCsrf(session, form.get("csrf")?.toString())) redirect("/forbidden");
  return session;
}

export async function requestIp(): Promise<string> {
  return clientIp({ headers: await headers() }) ?? "unknown";
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
