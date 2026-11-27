import { can, ROLE_LABELS } from "@/lib/auth/authorize";
import type { ValidSession } from "@/lib/auth/service";
import { visibleModules, type ModuleSettings } from "@/lib/modules/registry";
import { RailLink } from "./RailLink";

export const PRODUCT_NAME = "Waritchaphum Security Dashboard";

/** System Settings pages, shown to Security Administrators only. */
const SETTINGS_NAV = [
  { href: "/settings/modules", label: "โมดูล" },
  { href: "/settings/users", label: "ผู้ใช้และสิทธิ์" },
  { href: "/settings/notifications", label: "การแจ้งเตือน" },
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
  const modules = visibleModules(session.user.role, moduleSettings).filter((m) => can(session.user, m.routePermission));
  const isAdmin = can(session.user, "config.manage");
  return (
    <div className="app">
      <nav className="rail" aria-label="เมนูหลัก">
        <div className="brand">
          <b>{PRODUCT_NAME}</b>
          <span>โรงพยาบาลวาริชภูมิ</span>
        </div>
        {can(session.user, "incident.read") && <RailLink href="/overview">ภาพรวม</RailLink>}
        <h4>โมดูล</h4>
        {modules.map((m) => (
          <RailLink key={m.id} href={m.href}>
            {m.name}
          </RailLink>
        ))}
        {isAdmin && (
          <>
            <h4>ตั้งค่าระบบ</h4>
            {SETTINGS_NAV.map((item) => (
              <RailLink key={item.href} href={item.href}>
                {item.label}
              </RailLink>
            ))}
          </>
        )}
        <div className="who">
          <span>
            {session.user.displayName}
            <br />
            {ROLE_LABELS[session.user.role]}
          </span>
          <form action="/logout" method="post">
            <input type="hidden" name="csrf" value={session.csrfToken} />
            <button className="secondary sm" type="submit">
              ออกจากระบบ
            </button>
          </form>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}

export function CsrfInput({ session }: { session: ValidSession }) {
  return <input type="hidden" name="csrf" value={session.csrfToken} />;
}
