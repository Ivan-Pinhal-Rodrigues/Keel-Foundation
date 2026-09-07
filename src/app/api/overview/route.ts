import { NextResponse } from "next/server";
import { overviewResponse } from "@/lib/api/schemas/overview";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { buildOverview } from "@/server/modules/overview/service";

/**
 * `GET /api/overview` — the internal dashboard payload (`plan-04` Task 6).
 * No session → 401 (`getActor`). A guest → 403 (`requireInternal`, inside
 * `buildOverview`). An internal actor → 200 with the parsed payload.
 */
export const GET = withRequest(async (): Promise<Response> => {
  const actor = await getActor();
  const payload = await buildOverview(actor);
  return NextResponse.json(overviewResponse.parse(payload));
});
