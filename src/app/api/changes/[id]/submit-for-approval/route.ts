import { NextResponse } from "next/server";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { submitForApproval } from "@/server/modules/change/service";
import { requireInternal } from "@/server/policy/subjects/helpers";

/**
 * `POST /api/changes/:id/submit-for-approval` — the change owner opens the
 * approval request and moves the change `ASSESSING → APPROVAL`. Requires risk,
 * impact, and a rollback plan (403 otherwise); owner-only (403); a missing id is
 * a 404. `plans/plan-03-change-approvals` Task 8.
 *
 * A dynamic segment cannot ride the `export const POST = withRequest(...)`
 * shorthand (see `src/app/api/changes/[id]/route.ts`).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    // Gate before any load: a change is invisible to guests (spec 03), so an
    // unauthorized caller must get a bare 403 with no state disclosure. The
    // service's `authorize` also gates; this matches the module convention and
    // closes the timing/oracle window.
    requireInternal(actor);
    await runInTransaction((tx) => submitForApproval(actor, tx, id));
    return NextResponse.json({ ok: true });
  })(req);
}
