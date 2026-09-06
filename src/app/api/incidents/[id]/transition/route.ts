import { NextResponse } from "next/server";
import { transitionIncidentBody } from "@/lib/api/schemas/incidents";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { transitionIncident } from "@/server/modules/incident/service";

/**
 * `POST /api/incidents/:id/transition` — a `DEVELOPER` moves the incident along
 * the work path: `IN_PROGRESS`, `RESOLVED` (needs a non-empty `resolution`), or
 * `CLOSED` (from `RESOLVED` only). The reporter — and the assignee, when set —
 * are notified; a guest reporter is emailed the `incident_status` template.
 * `plans/plan-02-incident.md` Task 6.
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
    const input = transitionIncidentBody.parse(
      await req.json().catch(() => null),
    );
    await runInTransaction((tx) => transitionIncident(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
