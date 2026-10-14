import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/gate";
import { getServices, newCorrelationId } from "@/lib/server/context";

export async function POST(request: NextRequest) {
  const { auth } = getServices();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await auth.validateSession(token);
  const form = await request.formData();
  if (session && !auth.verifyCsrf(session, form.get("csrf")?.toString()))
    return new NextResponse("Forbidden", { status: 403 });
  await auth.logout(token, newCorrelationId());
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  // A __Host- cookie is only replaced by a Set-Cookie that is also Secure with Path=/.
  response.cookies.delete({ name: SESSION_COOKIE, path: "/", secure: true });
  return response;
}
