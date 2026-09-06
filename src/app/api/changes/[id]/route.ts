import { NextResponse } from "next/server";
import { editChangeBody } from "@/lib/api/schemas/changes";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { editChange, getChangeForActor } from "@/server/modules/change/service";

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

/**
 * `PATCH /api/changes/:id` — the owner or a DEVELOPER edits the RFC / risk /
 * impact / rollback fields. Rejected once the change is `IMPLEMENTING` or later
 * (403); a missing id is a 404. `plans/plan-03-change-approvals` Task 6.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    const input = editChangeBody.parse(await req.json().catch(() => null));
    await runInTransaction((tx) => editChange(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
