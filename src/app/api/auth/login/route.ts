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
 *
 * Rate-limit key: the body must be parsed before either check below, since
 * both key on the submitted email. See `rate-limit.ts` for why the primary
 * key is the email (always checked) and the IP is only ever an *additional*,
 * tightening check, never a substitute — an attacker who controls
 * `X-Forwarded-For` (true until a trusted ingress is in place, `specs/
 * 08-deploy-and-ci.md`) could otherwise mint a fresh bucket per request by
 * rotating the header.
 *
 * A malformed body (fails `req.json()` or `loginBody.safeParse`) is rejected
 * with 400 before any rate-limit check runs, deliberately: it's already cheap
 * to reject (no DB round-trip, no argon2), and this limiter exists "to blunt
 * credential stuffing against one box" (`rate-limit.ts`) — stuffing requires
 * a parseable credential attempt, so spending rate-limit budget on garbage
 * bodies isn't this limiter's job.
 */

export async function POST(req: Request): Promise<Response> {
  const body: unknown = await req.json().catch(() => null);
  const userAgent = req.headers.get("user-agent") ?? undefined;

  const parsed = loginBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  if (!rateLimit(`login:${normalizedEmail}`, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const ip = clientIp(req);
  if (ip !== null && !rateLimit(`login:${normalizedEmail}:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  return runWithContext(
    { requestId: randomUUID(), actorId: null },
    async (): Promise<Response> => {
      const result = await login(parsed.data, {
        userAgent,
        ip: ip ?? undefined,
      });
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

/** First hop of `x-forwarded-for`, else `x-real-ip`, else `null` when neither
 *  header is present — there is no IP signal to invent, so none is faked (no
 *  `"local"` fallback: that string used to collapse every unknown-IP client
 *  into one shared bucket). See `rate-limit.ts` on trusting XFF. */
function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    null
  );
}
