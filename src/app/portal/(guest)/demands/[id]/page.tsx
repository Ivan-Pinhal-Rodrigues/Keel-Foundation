import { notFound, redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { getDemandForActor } from "@/server/modules/demand/service";
import { NotFoundError } from "@/server/policy/errors";
import { PortalDemandDetail } from "../PortalDemandDetail";

/**
 * `/portal/demands/:id` — one of the guest's own requests
 * (`plans/plan-01-demand.md` Task 9). Under the `(guest)` route group (guarded
 * by `(guest)/layout.tsx`).
 *
 * `getDemandForActor` throws `NotFoundError` for a guest reaching another
 * client's demand (or a missing id) — the "not yours" read collapses to a 404,
 * never a 403 that would confirm the id exists. We turn that into Next's
 * `notFound()` so the guest sees the not-found page, not a 500.
 */
export default async function PortalDemandDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");

  const { id } = await params;

  let demand: Record<string, unknown>;
  try {
    demand = await getDemandForActor(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return <PortalDemandDetail demand={demand} />;
}
