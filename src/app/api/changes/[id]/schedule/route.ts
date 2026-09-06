import { NextResponse } from "next/server";
import { scheduleChangeBody } from "@/lib/api/schemas/changes";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { scheduleChange } from "@/server/modules/change/service";

/**
 * `POST /api/changes/:id/schedule` — a `DEVELOPER` sets or adjusts the change
 * window (a future range, start before end). On an `APPROVAL`-status change that
 * is approved (or an EMERGENCY), the same call also enters `SCHEDULED`. A window
 * that is not a valid future range is a 403; a missing id is a 404.
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
    const input = scheduleChangeBody.parse(await req.json().catch(() => null));
    await runInTransaction((tx) => scheduleChange(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
