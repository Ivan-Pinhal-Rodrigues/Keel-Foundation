import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";
import { getCurrentActor, whoami } from "@/server/auth/current";
import { NotificationsList } from "./NotificationsList";
import styles from "./notifications.module.css";

export const metadata: Metadata = {
  title: "Notifications — Keel",
};

/**
 * `/notifications` — the full notification list (spec 04 §7), the "See all"
 * target of the header bell.
 *
 * Deliberately a top-level route, OUTSIDE the `(internal)` group: a guest must
 * be able to reach their own rows, so there is no `AppShell` chrome and no
 * layout guard. This `async` server component runs its own guard — no session →
 * `/login` — but does NOT `requireInternal` and does NOT redirect guests. It may
 * import `src/server/**` (not `api/**`, no Prisma); the list itself is a
 * `"use client"` island that talks to `GET /api/notifications`.
 */
export default async function NotificationsPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");

  const me = await whoami();
  if (!me) redirect("/login");

  const home = actor.kind === "GUEST" ? "/portal" : "/overview";

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href={home} className={styles.brand}>
          <span className={styles.glyph} aria-hidden="true">
            <svg viewBox="0 0 30 30">
              <path d="M15 3 L26 9 L15 15 L4 9 Z" fill="currentColor" />
            </svg>
          </span>
          <b>Keel</b>
        </Link>
        <span className={styles.who}>{me.displayName}</span>
        <LogoutButton />
      </header>
      <main className={styles.main}>
        <h1 className={styles.heading}>Notifications</h1>
        <NotificationsList />
      </main>
    </div>
  );
}
