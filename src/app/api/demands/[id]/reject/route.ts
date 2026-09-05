import { NextResponse } from "next/server";
import { rejectBody } from "@/lib/api/schemas/demands";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { rejectDemand } from "@/server/modules/demand/service";

/**
 * `POST /api/demands/:id/reject` — a `BUSINESS_APPROVER` or `TECHNICAL_APPROVER`
 * declines a demand outright (from `WORTH_ASSESSED`, or a parked `APPROVED`),
 * recording the reason on `Demand.rejectionReason`. `plans/plan-01-demand.md`
 * Task 4.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    const input = rejectBody.parse(await req.json().catch(() => null));
    await runInTransaction((tx) => rejectDemand(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
