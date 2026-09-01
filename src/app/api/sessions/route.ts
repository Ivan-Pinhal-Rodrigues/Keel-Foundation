import { NextResponse } from "next/server";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { listAllSessions, listSessionsFor } from "@/server/auth/sessions";
import { hasHat } from "@/server/policy/actor";

/**
 * `GET /api/sessions` — the caller's own sessions. A `TECHNICAL_APPROVER` may
 * pass `?all=1` for everyone's; the param is silently ignored for anyone else
 * (`specs/00-foundation.md` §3.3). Rows never include `sessionToken`.
 *
 * `getActor()` throws `UnauthenticatedError` with no actor → `withRequest`'s
 * mapper turns that into 401.
 */
export const GET = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  const wantsAll = new URL(req.url).searchParams.get("all") === "1";

  const sessions =
    wantsAll && hasHat(actor, "TECHNICAL_APPROVER")
      ? await listAllSessions()
      : await listSessionsFor(actor);

  return NextResponse.json({ sessions });
});
