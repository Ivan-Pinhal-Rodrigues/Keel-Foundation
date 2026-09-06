import { NextResponse } from "next/server";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { getChangeForActor } from "@/server/modules/change/service";

/**
 * `GET /api/changes/:id` — one change, internal-serialized, with its approval
 * panel, lifecycle stepper, and activity timeline. A guest gets a 403 (plan
 * ruling P3); a missing id is a 404. `plans/plan-03-change-approvals` Task 5.
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
    return NextResponse.json(await getChangeForActor(actor, id));
  })(req);
}
