import { can, ROLE_LABELS } from "@/lib/auth/authorize";
import type { ValidSession } from "@/lib/auth/service";
import { visibleModules, type ModuleSettings } from "@/lib/modules/registry";
import { NavLinks, type NavGroup } from "./NavLinks";

export const PRODUCT_NAME = "Waritchaphum Security Dashboard";

/** System Settings pages (ADR 0011), shown to Security Administrators only. */
const SETTINGS_NAV = [
  { href: "/settings/modules", label: "โมดูล" },
  { href: "/settings/users", label: "ผู้ใช้และสิทธิ์" },
  { href: "/settings/notifications", label: "การแจ้งเตือน" },
  { href: "/settings/connectors", label: "การเชื่อมต่อ" },
  { href: "/settings/audit", label: "บันทึกการใช้งาน" },
];

export function AppShell({
  session,
  moduleSettings,
  children,
}: {
  session: ValidSession;
  moduleSettings: ModuleSettings;
  children: React.ReactNode;
}) {
  // A module link shows only when the module is on and the role may open its page.
  const modules = visibleModules(session.user.role, moduleSettings).filter((m) => can(session.user, m.routePermission));
  const groups: NavGroup[] = [
    { label: "ภาพรวม", items: can(session.user, "incident.read") ? [{ href: "/overview", label: "ภาพรวม" }] : [] },
    { label: "โมดูล", items: modules.map((m) => ({ href: m.href, label: m.name })) },
    { label: "ตั้งค่าระบบ", items: can(session.user, "config.manage") ? SETTINGS_NAV : [] },
  ].filter((group) => group.items.length > 0);
  return (
    <div className="shell">
      <header className="rail">
        <div className="brand">
          <strong>{PRODUCT_NAME}</strong>
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
