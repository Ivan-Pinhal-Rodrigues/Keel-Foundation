"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { NotificationBell } from "@/components/NotificationBell";
import { LogoutButton } from "@/components/LogoutButton";
import styles from "./portal.module.css";

/**
 * The guest portal top bar (plan-04 Task 10). Client component: it holds the
 * `<NotificationBell>` (which polls) and a `<details>` account menu. The org
 * name and display name arrive as plain string props — no server imports here.
 */
export function PortalTopBar({
  clientName,
  displayName,
}: {
  clientName: string | null;
  displayName: string;
}): ReactNode {
  return (
    <header className={styles.bar}>
      <span className={styles.brand}>
        <span className={styles.glyph} aria-hidden="true">
          <svg viewBox="0 0 30 30">
            <path d="M15 3 L26 9 L15 15 L4 9 Z" fill="currentColor" />
          </svg>
        </span>
        <b>Keel</b>
        {clientName ? <span className={styles.org}>{clientName}</span> : null}
      </span>

      <nav className={styles.nav} aria-label="Portal">
        <Link href="/portal/demands">My requests</Link>
        <Link href="/portal/incidents">My incidents</Link>
        <Link href="/portal/submit">Submit</Link>
      </nav>

      <div className={styles.actions}>
        <NotificationBell />
        <details className={styles.account}>
          <summary className={styles.accountTrigger}>
            <span className={styles.accountName}>{displayName}</span>
          </summary>
          <div className={styles.accountMenu}>
            <p className={styles.accountMenuName}>{displayName}</p>
            <LogoutButton />
          </div>
        </details>
      </div>
    </header>
  );
}
