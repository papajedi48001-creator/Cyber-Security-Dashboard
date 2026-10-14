import { NextResponse, type NextRequest } from "next/server";
import { gateRequest, SESSION_COOKIE } from "./lib/auth/gate";

// Trusted networks are read per request so the check cannot be baked in at build time.
function trustedNetworks(): string[] {
  return (process.env.TRUSTED_NETWORKS ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

export function middleware(request: NextRequest) {
  const decision = gateRequest(
    {
      pathname: request.nextUrl.pathname,
      headers: request.headers,
      hasSessionCookie: request.cookies.has(SESSION_COOKIE),
    },
    trustedNetworks(),
  );
  if (decision === "forbid") return new NextResponse("Forbidden", { status: 403 });
  if (decision === "login") return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
