import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { LogoutButton } from "@/components/LogoutButton";
import styles from "./portal.module.css";

/**
 * Shell + guard for the guest portal proper (`/portal`, `/portal/requests`,
 * `/portal/incidents`, `/portal/submit`, …). Server component: no session →
 * `/login`; an internal session → `/demands` (spec 07 §6 — internal users have
 * no portal).
 *
 * This is a route group so that `/portal/invite/:token` — which is PUBLIC (spec
 * 07 §4.1) and lives at `src/app/portal/invite/`, outside `(guest)/` — is not
 * caught by this guard.
 *
 * Deliberately minimal chrome: product mark + sign out. plan-04 replaces this
 * with the real portal layout (client org name, notification bell, account
 * menu, the three-item nav).
 */
export default async function GuestPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  if (actor.kind !== "GUEST") redirect("/demands");

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <span className={styles.brand}>
          <span className={styles.glyph} aria-hidden="true">
            <svg viewBox="0 0 30 30">
              <path d="M15 3 L26 9 L15 15 L4 9 Z" fill="currentColor" />
            </svg>
          </span>
          <b>Keel</b>
        </span>
        <LogoutButton />
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
