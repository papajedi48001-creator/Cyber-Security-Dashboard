import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { currentSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  return <AppShell session={session}>{children}</AppShell>;
}
