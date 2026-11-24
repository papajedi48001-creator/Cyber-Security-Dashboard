"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Left-rail link that marks itself as the current page. */
export function RailLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link className="nav" href={href} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}
