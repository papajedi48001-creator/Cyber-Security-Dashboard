import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/auth/network";
import { MFA_CHALLENGE_COOKIE, PROVIDER_ID_FLOW_COOKIE } from "@/lib/auth/provider-id";
import { MFA_CHALLENGE_MS } from "@/lib/auth/service";
import { getServices, newCorrelationId } from "@/lib/server/context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { providerId, config } = getServices();
  if (!providerId) return new NextResponse("Not Found", { status: 404 });
  const params = request.nextUrl.searchParams;
  const result = await providerId.callback(
    { code: params.get("code"), state: params.get("state"), error: params.get("error") },
    request.cookies.get(PROVIDER_ID_FLOW_COOKIE)?.value,
    { ip: clientIp(request) ?? "unknown", correlationId: newCorrelationId() },
  );
  const target = result.ok ? "/login/mfa" : `/login?provider_id=${result.reason}`;
  const response = NextResponse.redirect(new URL(target, config.portalBaseUrl), 303);
  // A __Host- cookie is only replaced by a Set-Cookie that is also Secure with Path=/.
  response.cookies.delete({ name: PROVIDER_ID_FLOW_COOKIE, path: "/", secure: true });
  if (result.ok)
    response.cookies.set(MFA_CHALLENGE_COOKIE, result.challenge, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: MFA_CHALLENGE_MS / 1000,
    });
  return response;
}
