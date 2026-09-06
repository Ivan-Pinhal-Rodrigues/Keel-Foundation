import { NextResponse } from "next/server";
import { reopenIncidentBody } from "@/lib/api/schemas/incidents";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { reopenIncident } from "@/server/modules/incident/service";

/**
 * `POST /api/incidents/:id/reopen` — a `DEVELOPER` reopens a `RESOLVED` incident
 * (any time) or a `CLOSED` one (only within 14 days of `closedAt`), moving it
 * back to `IN_PROGRESS` and clearing `resolvedAt` / `closedAt`. Audited with the
 * caller's `reason`. `plans/plan-02-incident.md` Task 6.
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
    const input = reopenIncidentBody.parse(await req.json().catch(() => null));
    await runInTransaction((tx) => reopenIncident(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
