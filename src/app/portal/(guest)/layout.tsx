import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentActor, whoami } from "@/server/auth/current";
import { PortalTopBar } from "./PortalTopBar";
import styles from "./portal.module.css";

/**
 * Shell + guard for the guest portal proper (`/portal`, `/portal/demands`,
 * `/portal/incidents`, `/portal/submit`, …). Server component: no session →
 * `/login`; an internal session → `/overview` (spec 07 §6 — internal users have
 * no portal).
 *
 * This is a route group so that `/portal/invite/:token` — which is PUBLIC (spec
 * 07 §4.1) and lives at `src/app/portal/invite/`, outside `(guest)/` — is not
 * caught by this guard.
 *
 * Chrome (client org name, notification bell, account menu) lives in the client
 * `<PortalTopBar>`.
 */
export default async function GuestPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  if (actor.kind !== "GUEST") redirect("/overview");

  // `whoami()` re-reads the same (cache-deduped) session for the display fields
  // the top bar needs. Non-null in practice — the guard just resolved the actor
  // — but a null means the session died mid-render: treat it as logged out.
  const me = await whoami();
  if (!me) redirect("/login");

  return (
    <div className={styles.shell}>
      <PortalTopBar clientName={me.clientName} displayName={me.displayName} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
