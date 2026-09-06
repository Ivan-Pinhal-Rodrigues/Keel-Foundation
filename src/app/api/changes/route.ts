import { NextResponse } from "next/server";
import { createChangeBody, listChangesQuery } from "@/lib/api/schemas/changes";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { createChange, listChanges } from "@/server/modules/change/service";

/**
 * `POST /api/changes` — create a change (DEVELOPER hat). `GET /api/changes` —
 * list, internal-only (`?status` / `?mine` / `?scheduled` filter). A guest gets
 * a 403 on both (plan ruling P3). `plans/plan-03-change-approvals` Task 5.
 */

export const POST = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  const input = createChangeBody.parse(await req.json().catch(() => null));
  const out = await runInTransaction((tx) => createChange(actor, tx, input));
  return NextResponse.json(out, { status: 201 });
});

export const GET = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  const filters = listChangesQuery.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  return NextResponse.json({ changes: await listChanges(actor, filters) });
});
