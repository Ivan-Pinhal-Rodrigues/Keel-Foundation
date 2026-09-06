import { NextResponse } from "next/server";
import { linkIncidentBody } from "@/lib/api/schemas/changes";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { linkIncident } from "@/server/modules/change/service";

/**
 * `POST /api/changes/:id/link-incident` — the owner or a DEVELOPER links an
 * incident to the change with a `CAUSED_BY` / `FIXES` kind. Idempotent on a
 * repeat; an unknown incident id is a 404. `plans/plan-03-change-approvals`
 * Task 6.
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
    const input = linkIncidentBody.parse(await req.json().catch(() => null));
    await runInTransaction((tx) => linkIncident(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
