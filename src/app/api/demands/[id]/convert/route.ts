import { NextResponse } from "next/server";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { convertDemand } from "@/server/modules/demand/service";

/**
 * `POST /api/demands/:id/convert` — a `BUSINESS_APPROVER` / `TECHNICAL_APPROVER`
 * turns an approved, pursued demand into a change (`APPROVED → CONVERTED`).
 * Idempotent: a second call returns the same `{ changeId, changeRef }` and
 * writes nothing further. Any other demand state is a 403; a missing id is a
 * 404. `plans/plan-03-change-approvals` Task 9.
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
    const result = await runInTransaction((tx) => convertDemand(actor, tx, id));
    return NextResponse.json(result);
  })(req);
}
