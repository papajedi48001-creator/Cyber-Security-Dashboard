import { isTrustedRequest } from "./network";

export const SESSION_COOKIE = "__Host-portal_session";
const PUBLIC_PATHS = ["/login", "/forbidden"];

export type GateDecision = "allow" | "forbid" | "login";

/** Edge decision for every request: network first, then presence of a session cookie. */
export function gateRequest(
  request: { pathname: string; headers: Headers; hasSessionCookie: boolean },
  trustedNetworks: readonly string[],
): GateDecision {
  if (!isTrustedRequest(request, trustedNetworks)) return "forbid";
  if (PUBLIC_PATHS.some((p) => request.pathname === p || request.pathname.startsWith(`${p}/`))) return "allow";
  return request.hasSessionCookie ? "allow" : "login";
}
