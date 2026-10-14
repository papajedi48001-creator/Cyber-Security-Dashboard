import { redirect } from "next/navigation";
import { can } from "@/lib/auth/authorize";
import { currentSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await currentSession();
  if (!session) redirect("/login");
  redirect(can(session.user, "incident.read") ? "/overview" : "/executive");
}
