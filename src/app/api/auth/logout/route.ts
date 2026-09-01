import { NextResponse } from "next/server";
import { withRequest } from "@/lib/api/with-request";
import { SESSION_COOKIE, readCookie } from "@/lib/http/cookies";
import { getActorOrNull } from "@/server/auth/actor";
import { logout } from "@/server/auth/sessions";

/**
 * `POST /api/auth/logout` — drop the caller's session row and clear the cookie
 * (`specs/00-foundation.md` §3.3). Idempotent: 200 `{ ok: true }` even with no
 * session, and `auth.logout` is emitted on every path (§3.4).
 *
 * Not in middleware's PUBLIC list — a request with no cookie at all is 401'd
 * before it reaches here; this handles the cookie-present-but-dead case.
 */
export const POST = withRequest(async (req): Promise<Response> => {
  const actor = await getActorOrNull();
  const token = readCookie(req, SESSION_COOKIE);

  await logout(actor?.id ?? null, token);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: "/",
  });
  return res;
});
