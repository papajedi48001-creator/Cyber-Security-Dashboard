import { NextResponse } from "next/server";
import { PROVIDER_ID_FLOW_COOKIE, PROVIDER_ID_FLOW_SECONDS } from "@/lib/auth/provider-id";
import { getServices } from "@/lib/server/context";

export const dynamic = "force-dynamic";

export async function GET() {
  const { providerId } = getServices();
  if (!providerId) return new NextResponse("Not Found", { status: 404 });
  const { url, flow } = providerId.start();
  const response = NextResponse.redirect(url, 302);
  response.cookies.set(PROVIDER_ID_FLOW_COOKIE, flow, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: PROVIDER_ID_FLOW_SECONDS,
  });
  return response;
}
