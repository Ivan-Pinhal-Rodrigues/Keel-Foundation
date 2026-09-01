import { NextResponse } from "next/server";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { revokeSession } from "@/server/auth/sessions";

/**
 * `DELETE /api/sessions/:id` — revoke a session. Your own always; anyone's if
 * you hold `TECHNICAL_APPROVER`. Someone else's when you do not, or an id that
 * does not exist → 404, so the endpoint never confirms a session id
 * (`specs/00-foundation.md` §3.3). Emits `session.revoked` (§3.4).
 *
 * A dynamic segment cannot ride the `export const DELETE = withRequest(...)`
 * shorthand — the wrapper's frozen contract is `(req) => Response`, with no
 * `params`. So the id is read here and the wrapped handler closes over it.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    const result = await revokeSession(id, actor);
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  })(req);
}
