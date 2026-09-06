import { notFound, redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { getIncidentForActor } from "@/server/modules/incident/service";
import { NotFoundError } from "@/server/policy/errors";
import { PortalIncidentDetail } from "../PortalIncidentDetail";

/**
 * `/portal/incidents/:id` — one of the guest's own incidents
 * (`plans/plan-02-incident.md` Task 10). Under the `(guest)` route group
 * (guarded by `(guest)/layout.tsx`).
 *
 * `getIncidentForActor` throws `NotFoundError` for a guest reaching another
 * client's incident (or a missing id) — the "not yours" read collapses to a
 * 404, never a 403 that would confirm the id exists. We turn that into Next's
 * `notFound()` so the guest sees the not-found page, not a 500.
 */
export default async function PortalIncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");

  const { id } = await params;

  let incident: Record<string, unknown>;
  try {
    incident = await getIncidentForActor(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return <PortalIncidentDetail incident={incident} />;
}
