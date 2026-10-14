import Link from "next/link";
import { can, ROLE_LABELS, type Permission } from "@/lib/auth/authorize";
import type { ValidSession } from "@/lib/auth/service";

const NAV: { href: string; label: string; permission: Permission }[] = [
  { href: "/overview", label: "ภาพรวม", permission: "incident.read" },
  { href: "/incidents", label: "Incident", permission: "incident.read" },
  { href: "/sources", label: "แหล่ง Log", permission: "source.read" },
  { href: "/assets", label: "Asset", permission: "asset.read" },
  { href: "/backups", label: "Backup", permission: "incident.read" },
  { href: "/port-monitor", label: "พอร์ต", permission: "incident.read" },
  { href: "/web-application-firewall", label: "WAF", permission: "incident.read" },
  { href: "/duo", label: "Duo", permission: "incident.read" },
  { href: "/executive", label: "รายงานผู้บริหาร", permission: "executive.read" },
  { href: "/admin/users", label: "ผู้ใช้", permission: "user.manage" },
];

export function AppShell({ session, children }: { session: ValidSession; children: React.ReactNode }) {
  return (
    <>
      <header className="top">
        <strong>Security Operations Portal</strong>
        <nav>
          {NAV.filter((item) => can(session.user, item.permission)).map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <span className="who">
          {session.user.displayName} ({ROLE_LABELS[session.user.role]})
        </span>
        <form action="/logout" method="post">
          <input type="hidden" name="csrf" value={session.csrfToken} />
          <button className="secondary" type="submit">
            ออกจากระบบ
          </button>
        </form>
      </header>
      <main>{children}</main>
    </>
  );
}

export function CsrfInput({ session }: { session: ValidSession }) {
  return <input type="hidden" name="csrf" value={session.csrfToken} />;
}
