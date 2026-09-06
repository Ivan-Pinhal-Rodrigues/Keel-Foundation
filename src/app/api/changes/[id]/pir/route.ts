import { NextResponse } from "next/server";
import { pirBody } from "@/lib/api/schemas/changes";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { recordPir } from "@/server/modules/change/service";

/**
 * `POST /api/changes/:id/pir` — a `BUSINESS_APPROVER` / `TECHNICAL_APPROVER`
 * records the post-implementation review (value realized + lessons) on a change
 * that is in review. The PIR is a record-of-fact — written once; a second call
 * is a 409. Any other status is a 403; a missing id is a 404.
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
    const input = pirBody.parse(await req.json().catch(() => null));
    await runInTransaction((tx) => recordPir(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
