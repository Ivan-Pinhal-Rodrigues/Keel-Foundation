"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
  badge?: number;
};

export type AppShellProps = {
  nav: NavItem[];
  currentKey: string;
  user: { name: string; sub: string };
  topbar?: ReactNode;
  children: ReactNode;
};

const MOBILE_QUERY = "(max-width: 920px)";

/**
 * Tracks the prototype's `@media (max-width: 920px)` breakpoint. The visual
 * switch to the bottom-bar layout is done in CSS; this only exposes the state
 * to JS (and to tests) via `data-mobile` on the shell root.
 */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return isMobile;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function AppShell({
  nav,
  currentKey,
  user,
  topbar,
  children,
}: AppShellProps) {
  const isMobile = useIsMobile();
  return (
    <div className={styles.app} data-mobile={isMobile ? "true" : undefined}>
      <aside className={styles.rail}>
        <div className={styles.brand}>
          <span className={styles.glyph} aria-hidden="true">
            <svg viewBox="0 0 30 30">
              <path
                d="M15 3 L26 9 L15 15 L4 9 Z"
                fill="currentColor"
                opacity=".95"
              />
              <path
                d="M4 15 L15 21 L26 15"
                stroke="currentColor"
                strokeWidth="2.4"
                fill="none"
                opacity=".6"
              />
              <path
                d="M4 21 L15 27 L26 21"
                stroke="currentColor"
                strokeWidth="2.4"
                fill="none"
                opacity=".3"
              />
            </svg>
          </span>
          <span>
            <b>Keel</b>
            <span>itsm</span>
          </span>
        </div>

        <nav className={styles.nav} aria-label="Primary">
          {nav.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className={styles.navItem}
              aria-current={item.key === currentKey ? "page" : undefined}
            >
              <span className={styles.ico}>{item.icon}</span>
              {item.label}
              {item.badge !== undefined ? (
                <span className={styles.badge}>{item.badge}</span>
              ) : null}
            </a>
          ))}
        </nav>

        <div className={styles.railFoot}>
          <div className={styles.who}>
            <span className={styles.ava}>{initials(user.name)}</span>
            <span>
              <b>{user.name}</b> <small>{user.sub}</small>
            </span>
          </div>
        </div>
      </aside>

      <div className={styles.stage}>
        <header className={styles.topbar}>{topbar}</header>
        <div className={styles.view}>{children}</div>
      </div>
    </div>
  );
}
