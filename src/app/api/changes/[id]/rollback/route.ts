import { NextResponse } from "next/server";
import { rollbackChangeBody } from "@/lib/api/schemas/changes";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { rollbackChange } from "@/server/modules/change/service";

/**
 * `POST /api/changes/:id/rollback` — a `DEVELOPER` rolls an `IMPLEMENTING` change
 * back to the terminal `ROLLED_BACK` state, with a required note. Any other
 * status is a 403; a missing id is a 404. `plans/plan-03-change-approvals`
 * Task 7.
 *
 * A dynamic segment cannot ride the `export const POST = withRequest(...)`
 * shorthand — the id is read here and the wrapped handler closes over it.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    const input = rollbackChangeBody.parse(await req.json().catch(() => null));
    await runInTransaction((tx) => rollbackChange(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
