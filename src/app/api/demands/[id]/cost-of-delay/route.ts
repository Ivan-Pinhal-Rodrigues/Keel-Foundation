import { NextResponse } from "next/server";
import { costOfDelayBody } from "@/lib/api/schemas/demands";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { setCostOfDelay } from "@/server/modules/demand/service";

/**
 * `PATCH /api/demands/:id/cost-of-delay` — any internal user records the
 * cost-of-delay narrative (spec §8.2). Completing the worth gate flips the
 * demand to WORTH_ASSESSED. `plans/plan-01-demand.md` Task 3.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    const input = costOfDelayBody.parse(await req.json().catch(() => null));
    await runInTransaction((tx) => setCostOfDelay(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
