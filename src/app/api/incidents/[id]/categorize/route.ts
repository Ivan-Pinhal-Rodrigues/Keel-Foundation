import { NextResponse } from "next/server";
import { categorizeIncidentBody } from "@/lib/api/schemas/incidents";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { categorizeIncident } from "@/server/modules/incident/service";

/**
 * `PATCH /api/incidents/:id/categorize` — a `DEVELOPER` sets impact / urgency and
 * the derived priority. While the incident is `NEW` / `ASSIGNED` the SLA clock is
 * recomputed; once work has started a `reason` is required and `dueAt` is left
 * alone (plan ruling 5). `plans/plan-02-incident.md` Task 5.
 *
 * A dynamic segment cannot ride the `export const PATCH = withRequest(...)`
 * shorthand — the id is read here and the wrapped handler closes over it.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    const input = categorizeIncidentBody.parse(
      await req.json().catch(() => null),
    );
    await runInTransaction((tx) => categorizeIncident(actor, tx, id, input));
    return NextResponse.json({ ok: true });
  })(req);
}
