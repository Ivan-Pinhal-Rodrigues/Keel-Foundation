import { NextResponse } from "next/server";
import { createDemandBody, listDemandsQuery } from "@/lib/api/schemas/demands";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { createDemand, listDemands } from "@/server/modules/demand/service";

/**
 * `POST /api/demands` — create a demand. `GET /api/demands` — list, scoped to
 * the actor (a guest sees only their own client's; `?status` / `?source` /
 * `?mine` filter). `plans/plan-01-demand.md` Task 2.
 */

export const POST = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  const input = createDemandBody.parse(await req.json().catch(() => null));
  const out = await runInTransaction((tx) => createDemand(actor, tx, input));
  return NextResponse.json(out, { status: 201 });
});

export const GET = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  const filters = listDemandsQuery.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  return NextResponse.json({ demands: await listDemands(actor, filters) });
});
