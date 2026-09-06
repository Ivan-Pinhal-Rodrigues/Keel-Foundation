import { NextResponse } from "next/server";
import { advanceChangeBody } from "@/lib/api/schemas/changes";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { advanceChange } from "@/server/modules/change/service";

/**
 * `POST /api/changes/:id/advance` — a `DEVELOPER` advances the change one stage
 * along its lifecycle. The stage's exit gate must be satisfied (403 otherwise);
 * a stale `from` is a 409; a missing id is a 404.
 * `plans/plan-03-change-approvals` Task 7.
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
    const input = advanceChangeBody.parse(await req.json().catch(() => null));
    await runInTransaction((tx) => advanceChange(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
