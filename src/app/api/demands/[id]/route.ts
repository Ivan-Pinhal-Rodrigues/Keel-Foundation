import { NextResponse } from "next/server";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { getDemandForActor } from "@/server/modules/demand/service";

/**
 * `GET /api/demands/:id` — one demand, role-serialized. A guest reaching another
 * client's demand (or a missing id) gets a 404. `plans/plan-01-demand.md` Task 2.
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
    return NextResponse.json(await getDemandForActor(actor, id));
  })(req);
}
