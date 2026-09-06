import { NextResponse } from "next/server";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { getIncidentForActor } from "@/server/modules/incident/service";

/**
 * `GET /api/incidents/:id` — one incident, role-serialized, with its activity
 * timeline and (internal only) linked changes. A guest reaching another client's
 * incident (or a missing id) gets a 404. `plans/plan-02-incident.md` Task 4.
 *
 * A dynamic segment cannot ride the `export const GET = withRequest(...)`
 * shorthand — the wrapper's frozen contract is `(req) => Response`, with no
 * `params`. So the id is read here and the wrapped handler closes over it.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    return NextResponse.json(await getIncidentForActor(actor, id));
  })(req);
}
