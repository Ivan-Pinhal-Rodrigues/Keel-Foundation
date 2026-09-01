import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rate-limit";
import { loginBody } from "@/lib/api/schemas/auth";
import { authenticate } from "@/server/auth/credentials";
import { SESSION_COOKIE, createSession } from "@/server/auth/session";

/**
 * `POST /api/auth/login` — `{ email, password }` → 200 + session cookie, or a
 * status. `specs/00-foundation.md` §3.3.
 *
 * Client metadata is read off the request rather than `next/headers`, and the
 * cookie is set on the returned `NextResponse` rather than through
 * `cookies()`: both keep the handler a plain `Request -> Response` function, so
 * the route test can call `POST(new Request(...))` with no Next request scope
 * and read `Set-Cookie` straight off the result.
 */

export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req);
  if (!rateLimit(`login:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = loginBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const user = await authenticate(parsed.data);
  if (!user) {
    // One response for wrong password / unknown email / deactivated account.
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const { token, expires } = await createSession(user.id, {
    userAgent: req.headers.get("user-agent") ?? undefined,
    ip,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires,
    path: "/",
  });
  return res;
}

/** First hop of `x-forwarded-for` (the client), else a placeholder so the rate
 *  limiter still has a key in local dev. */
function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "local"
  );
}
