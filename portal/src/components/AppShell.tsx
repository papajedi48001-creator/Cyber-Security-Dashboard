import { can, ROLE_LABELS, type Permission } from "@/lib/auth/authorize";
import type { ValidSession } from "@/lib/auth/service";
import { NavLinks, type NavGroup } from "./NavLinks";

const NAV: { label: string; items: { href: string; label: string; permission: Permission }[] }[] = [
  {
    label: "เฝ้าระวัง",
    items: [
      { href: "/overview", label: "ภาพรวม", permission: "incident.read" },
      { href: "/incidents", label: "Incident", permission: "incident.read" },
      { href: "/sources", label: "แหล่ง Log", permission: "source.read" },
    ],
  },
  {
    label: "หลักฐาน",
    items: [
      { href: "/backups", label: "Backup", permission: "evidence.read" },
      { href: "/backups/files", label: "ไฟล์ Backup HOSxP", permission: "evidence.read" },
      { href: "/port-monitor", label: "พอร์ต", permission: "evidence.read" },
      { href: "/web-application-firewall", label: "WAF", permission: "evidence.read" },
      { href: "/duo", label: "Duo", permission: "evidence.read" },
    ],
  },
  {
    label: "รายงาน",
    items: [{ href: "/executive", label: "รายงานผู้บริหาร", permission: "executive.read" }],
  },
  {
    label: "ดูแลระบบ",
    items: [
      { href: "/assets", label: "Asset", permission: "asset.read" },
      { href: "/admin/users", label: "ผู้ใช้", permission: "user.manage" },
    ],
  },
];

export function AppShell({ session, children }: { session: ValidSession; children: React.ReactNode }) {
  const groups: NavGroup[] = NAV.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => can(session.user, item.permission)).map(({ href, label }) => ({ href, label })),
  })).filter((group) => group.items.length > 0);
  return (
    <div className="shell">
      <header className="rail">
        <div className="brand">
          <strong>Security Operations Portal</strong>
          <span>โรงพยาบาลวาริชภูมิ</span>
        </div>
        <NavLinks groups={groups} />
        <div className="who">
          <strong>{session.user.displayName}</strong>
          <span>{ROLE_LABELS[session.user.role]}</span>
          <form action="/logout" method="post">
            <input type="hidden" name="csrf" value={session.csrfToken} />
            <button className="secondary" type="submit">
              ออกจากระบบ
            </button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

export function CsrfInput({ session }: { session: ValidSession }) {
  return <input type="hidden" name="csrf" value={session.csrfToken} />;
}
