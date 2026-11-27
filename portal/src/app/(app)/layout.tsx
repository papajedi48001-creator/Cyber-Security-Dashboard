import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getServices } from "@/lib/server/context";
import { currentSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  const moduleSettings = await getServices().modules.settings();
  return (
    <AppShell session={session} moduleSettings={moduleSettings}>
      {children}
    </AppShell>
  );
}
