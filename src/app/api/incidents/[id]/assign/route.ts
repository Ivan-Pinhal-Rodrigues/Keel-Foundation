import { NextResponse } from "next/server";
import { assignIncidentBody } from "@/lib/api/schemas/incidents";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { assignIncident } from "@/server/modules/incident/service";

/**
 * `POST /api/incidents/:id/assign` — a `DEVELOPER` assigns the incident to an
 * active internal user. A `NEW` incident also advances to `ASSIGNED`; a
 * `RESOLVED` / `CLOSED` one is rejected (plan ruling 4). The new assignee is
 * notified. `plans/plan-02-incident.md` Task 5.
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
    const input = assignIncidentBody.parse(await req.json().catch(() => null));
    await runInTransaction((tx) => assignIncident(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
