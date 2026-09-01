import { NextResponse } from "next/server";
import { createInviteBody } from "@/lib/api/schemas/invites";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { createInvite } from "@/server/auth/invites";
import { runInTransaction } from "@/server/db/tx";

/**
 * `POST /api/guest-invites` — an internal user invites a guest of some client
 * organisation. `{ clientId, email }` → `{ url }` (`specs/00-foundation.md`
 * §3.3).
 *
 * `withRequest` resolves the actor (no session → `getActor()` throws
 * `UnauthenticatedError` → 401). A guest actor reaches `createInvite`, which
 * throws `ForbiddenError` → `mapError` → 403. A bad body throws `ZodError` →
 * 400.
 */
export const POST = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  const input = createInviteBody.parse(await req.json().catch(() => null));
  const { url } = await runInTransaction((tx) =>
    createInvite(actor, tx, input),
  );
  return NextResponse.json({ url });
});
