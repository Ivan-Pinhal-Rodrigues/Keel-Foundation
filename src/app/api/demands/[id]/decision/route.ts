import { NextResponse } from "next/server";
import { decisionBody } from "@/lib/api/schemas/demands";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { decideDemand } from "@/server/modules/demand/service";

/**
 * `POST /api/demands/:id/decision` — a `BUSINESS_APPROVER` or
 * `TECHNICAL_APPROVER` records the worth decision: `PURSUE` / `PARK` →
 * `APPROVED`, `DROP` → `REJECTED`. `plans/plan-01-demand.md` Task 4.
 *
 * When the caller is the demand's submitter and sent no justification, the
 * `demand.decide` policy rule throws `SegregationError` → 409
 * `{ error: "segregation", overrideAction: "demand.decide.override" }` (mapped
 * in `src/lib/api/errors.ts`, propagated untouched by this handler). A resend
 * carrying a `>= 20`-char `overrideJustification` takes the single-approver
 * override path.
 *
 * A dynamic segment cannot ride the `export const POST = withRequest(...)`
 * shorthand (see `src/app/api/sessions/[id]/route.ts`).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    const input = decisionBody.parse(await req.json().catch(() => null));
    await runInTransaction((tx) => decideDemand(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
