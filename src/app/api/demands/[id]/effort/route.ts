import { NextResponse } from "next/server";
import { scoreEffortBody } from "@/lib/api/schemas/demands";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { scoreEffort } from "@/server/modules/demand/service";

/**
 * `PATCH /api/demands/:id/effort` — a `TECHNICAL_APPROVER` records the effort
 * sizing (S/M/L) + optional feasibility narrative. Completing the worth gate
 * flips the demand to WORTH_ASSESSED. `plans/plan-01-demand.md` Task 3.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    const input = scoreEffortBody.parse(await req.json().catch(() => null));
    await runInTransaction((tx) => scoreEffort(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
