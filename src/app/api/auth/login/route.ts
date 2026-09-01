import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rate-limit";
import { loginBody } from "@/lib/api/schemas/auth";
import { login } from "@/server/auth/login";
import { SESSION_COOKIE } from "@/server/auth/session";
import { runWithContext } from "@/server/context";

/**
 * `POST /api/auth/login` — `{ email, password }` → 200 + session cookie, or a
 * status. `specs/00-foundation.md` §3.3.
 *
 * This endpoint is public and pre-auth, so no `withRequest` wrapper reaches it:
 * it mints its own request id and opens the context itself, which is what ties
 * its `auth.login` / `auth.login_failed` event to the request that caused it.
 * The rate-limit check sits outside that context deliberately — a throttled
 * request never reaches a credential check and must leave no audit row.
 *
 * Client metadata is read off the request rather than `next/headers`, and the
 * cookie is set on the returned `NextResponse` rather than through `cookies()`:
 * both keep the handler a plain `Request -> Response` function, so the route
 * test can call `POST(new Request(...))` with no Next request scope and read
 * `Set-Cookie` straight off the result.
 */

export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req);
  if (!rateLimit(`login:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body: unknown = await req.json().catch(() => null);
  const userAgent = req.headers.get("user-agent") ?? undefined;

  return runWithContext(
    { requestId: randomUUID(), actorId: null },
    async (): Promise<Response> => {
      const parsed = loginBody.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "invalid" }, { status: 400 });
      }

      const result = await login(parsed.data, { userAgent, ip });
      if (!result.ok) {
        // One response for wrong password / unknown email / deactivated
        // account — and `verifyCredentials` makes them cost the same, so the
        // timing does not distinguish them either.
        return NextResponse.json(
          { error: "invalid_credentials" },
          { status: 401 },
        );
      }

      const res = NextResponse.json({ ok: true });
      res.cookies.set(SESSION_COOKIE, result.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        expires: result.expires,
        path: "/",
      });
      return res;
    },
  );
}

/** First hop of `x-forwarded-for` (the client), else a placeholder so the rate
 *  limiter still has a key in local dev. See `rate-limit.ts` on trusting XFF. */
function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "local"
  );
}
