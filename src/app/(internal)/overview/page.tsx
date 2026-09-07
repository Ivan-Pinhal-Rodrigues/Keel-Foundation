import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { buildOverview } from "@/server/modules/overview/service";
import { OverviewClient } from "./OverviewClient";

/**
 * `/overview` — the internal dashboard (spec 06 §5, `plan-04` Task 7).
 *
 * `async` server component, mirroring `approvals/page.tsx`: it resolves the
 * actor from the session cookie (`getCurrentActor`, the RSC-safe reader),
 * redirects a missing session to `/login` and a guest to `/portal`, then calls
 * `buildOverview` directly — a server component MAY import `@/server/**` (it is
 * not `api/**` and pulls in no Prisma value). The payload seeds
 * `<OverviewClient>`, which re-fetches `/api/overview` on its own thereafter.
 */
export default async function OverviewPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  if (actor.kind !== "INTERNAL") redirect("/portal");

  const initial = await buildOverview(actor);

  return <OverviewClient initial={initial} />;
}
