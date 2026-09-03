import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import type { Me } from "@/server/auth/current";
import { getCurrentActor, whoami } from "@/server/auth/current";
import { AppShellChrome } from "./AppShellChrome";

/**
 * Layout for every authenticated internal screen (`src/app/(internal)/**`).
 *
 * Server component: it runs the actor guard on each request before any child
 * renders. No session → `/login`; a guest session → the portal (internal
 * screens are not theirs). The client chrome — the nav with `usePathname()` and
 * the logout button — lives in `<AppShellChrome>`.
 */
export default async function InternalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  if (actor.kind !== "INTERNAL") redirect("/portal");

  // `whoami()` re-reads the same session for the display fields the AppShell
  // user block needs. It is non-null in practice — the guard above just
  // resolved the actor — but a null here means the session died mid-render, so
  // treat it as logged out.
  const me = await whoami();
  if (!me) redirect("/login");

  return (
    <AppShellChrome user={{ name: me.displayName, sub: hatSummary(me) }}>
      {children}
    </AppShellChrome>
  );
}

const HAT_LABELS: Record<Me["hats"][number], string> = {
  DEVELOPER: "Developer",
  REVIEWER: "Reviewer",
  BUSINESS_APPROVER: "Business Approver",
  TECHNICAL_APPROVER: "Technical Approver",
};

/**
 * A short summary of the actor's hats for the AppShell user block, e.g.
 * `"Developer · Reviewer"`, or `"—"` when they hold none. Pure.
 */
function hatSummary(me: Me): string {
  if (me.hats.length === 0) return "—";
  return me.hats.map((hat) => HAT_LABELS[hat]).join(" · ");
}
