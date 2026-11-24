import { can, ROLE_LABELS } from "@/lib/auth/authorize";
import type { ValidSession } from "@/lib/auth/service";
import { settingsNavigation, visibleModules, type ModuleSettings } from "@/lib/modules/registry";
import { NavLink } from "./NavLink";

export function AppShell({
  session,
  moduleSettings,
  children,
}: {
  session: ValidSession;
  moduleSettings: ModuleSettings;
  children: React.ReactNode;
}) {
  const role = session.user.role;
  const modules = visibleModules(role, moduleSettings);
  const settings = settingsNavigation(role);
  return (
    <div className="shell">
      <header className="top">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">W</span>
          <span>Waritchaphum Security Dashboard</span>
        </span>
        <span className="who">
          {session.user.displayName} · {ROLE_LABELS[role]}
        </span>
        <form action="/logout" method="post">
          <input type="hidden" name="csrf" value={session.csrfToken} />
          <button className="secondary" type="submit">
            ออกจากระบบ
          </button>
        </form>
      </header>
      <nav className="rail" aria-label="เมนูหลัก">
        {can(session.user, "incident.read") && <NavLink href="/overview">ภาพรวม</NavLink>}
        <div className="rail-group">โมดูล</div>
        {modules.map((m) => (
          <NavLink key={m.id} href={m.href}>
            {m.name}
          </NavLink>
        ))}
        {settings.length > 0 && (
          <>
            <div className="rail-group">ตั้งค่าระบบ</div>
            {settings.map((l) => (
              <NavLink key={l.href} href={l.href}>
                {l.label}
              </NavLink>
            ))}
          </>
        )}
      </nav>
      <main>{children}</main>
    </div>
  );
}

export function CsrfInput({ session }: { session: ValidSession }) {
  return <input type="hidden" name="csrf" value={session.csrfToken} />;
}
