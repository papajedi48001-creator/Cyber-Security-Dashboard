"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavGroup {
  label: string;
  items: { href: string; label: string }[];
}

export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // The longest matching link is current, so /backups/files does not also mark /backups.
  const active = hrefs.filter(matches).sort((a, b) => b.length - a.length)[0];
  const current = (href: string) => href === active;
  return (
    <nav aria-label="เมนูหลัก">
      {groups.map((group) => (
        <div key={group.label} className="nav-group" role="group" aria-label={group.label}>
          <span aria-hidden="true">{group.label}</span>
          {group.items.map((item) => (
            <Link key={item.href} href={item.href} aria-current={current(item.href) ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
