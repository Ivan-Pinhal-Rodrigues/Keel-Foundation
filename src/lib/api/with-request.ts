import { readCookie } from "@/lib/http/cookies";
import { mapError } from "@/lib/api/errors";
import {
  SESSION_COOKIE,
  getSessionAndUser,
  touchSession,
} from "@/server/auth/session";
import { runWithContext } from "@/server/context";
import type { Actor } from "@/server/policy/actor";

/**
 * The wrapper every `api/**` route handler goes through. FROZEN contract —
 * `plans/specs/00-foundation.md` §8, `plans/DESIGN.md` §8.
 *
 * It does, per request:
 *  1. Take the `x-request-id` the Edge middleware forwarded (or mint one — e.g.
 *     a handler called directly in a test).
 *  2. Resolve the session cookie to `{ session, user }` (or `null`), slide its
 *     expiry with `touchSession`, and build the `Actor` — the same shape
 *     `loadActor` produces.
 *  3. Open the request context (`runWithContext`) with the request id, the
 *     actor id, and the actor itself stashed so `getActor()` needs no second
 *     query.
 *  4. Run the handler.
 *
 * Everything from the cookie read onward — session resolution, `touchSession`,
 * and the handler — sits inside one `try/catch` that funnels through
 * `mapError`, so a DB blip during session resolution surfaces as a structured
 * 500 with a `logger.error` rather than an unhandled throw. On this path
 * `mapError` runs outside the request context; it does not read
 * `getRequestId()`. If Task 18's extended `mapError` needs the request id, pass
 * it as an argument.
 */

export type RequestContext = { requestId: string; actor: Actor | null };

export function withRequest(
  handler: (req: Request, ctx: RequestContext) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

    try {
      let actor: Actor | null = null;
      const token = readCookie(req, SESSION_COOKIE);
      if (token) {
        const s = await getSessionAndUser(token);
        if (s) {
          await touchSession(token);
          actor = {
            id: s.user.id,
            kind: s.user.kind,
            hats: s.user.hats,
            clientId: s.user.clientId,
          };
        }
      }

      const ctx: RequestContext = { requestId, actor };
      return await runWithContext(
        { requestId, actorId: actor?.id ?? null, actor },
        async () => handler(req, ctx),
      );
    } catch (e) {
      return mapError(e);
    }
  };
}
