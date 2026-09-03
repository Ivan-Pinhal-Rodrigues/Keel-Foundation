"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell, type NavItem } from "@/components/AppShell";
import { LogoutButton } from "@/components/LogoutButton";
import { navKeyFor } from "./nav";
import styles from "./AppShellChrome.module.css";

/**
 * Client wrapper around the (server) `<AppShell>`. It owns the two things the
 * shell needs that only exist on the client: the nav array and the
 * `usePathname()`-derived `currentKey`, plus the logout control in the topbar.
 *
 * `AppShell` itself has no `"use client"` — importing it here just pulls that
 * thin presentational tree into the client bundle, which is fine.
 */

// Primary nav. Demand is the only internal surface in Phase 1 plan-01; later
// plans append Incidents / Changes / Approvals / Dashboards here.
const NAV: NavItem[] = [
  {
    key: "demands",
    label: "Demand",
    href: "/demands",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
  },
];

export function AppShellChrome({
  user,
  children,
}: {
  user: { name: string; sub: string };
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";

  return (
    <AppShell
      nav={NAV}
      currentKey={navKeyFor(pathname, NAV)}
      user={user}
      topbar={
        <div className={styles.topbar}>
          <LogoutButton />
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
