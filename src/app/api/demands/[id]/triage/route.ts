import { NextResponse } from "next/server";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { startTriage } from "@/server/modules/demand/service";

/**
 * `POST /api/demands/:id/triage` — an internal user picks up a demand
 * (SUBMITTED → TRIAGING) and an empty `WorthAssessment` is created.
 * `plans/plan-01-demand.md` Task 3.
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
    await runInTransaction((tx) => startTriage(actor, tx, id));
    return NextResponse.json({ ok: true });
  })(req);
}
