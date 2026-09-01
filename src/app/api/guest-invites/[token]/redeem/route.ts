import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { redeemInviteBody } from "@/lib/api/schemas/invites";
import { redeemInvite } from "@/server/auth/invites";
import { SESSION_COOKIE, createSession } from "@/server/auth/session";
import { runWithContext } from "@/server/context";
import { runInTransaction } from "@/server/db/tx";
import { GoneError } from "@/server/policy/errors";

/**
 * `POST /api/guest-invites/:token/redeem` — `{ name, password }` → creates the
 * scoped `GUEST` user, marks the invite redeemed, and logs them in
 * (`specs/00-foundation.md` §3.3). Unknown / expired / already-redeemed → 410.
 *
 * Public and pre-auth, like `POST /api/auth/login` — no `withRequest` reaches
 * it, so it mints its own request id and opens the context itself (that ties
 * the `guest_invite.redeemed` event to this request). Without the wrapper there
 * is no `mapError`, so `GoneError` and a bad body are turned into responses
 * here. Middleware's `PUBLIC` list carries the matching route.
 *
 * Client metadata is read off the request and the cookie is set on the returned
 * `NextResponse` — both keep the handler a plain `Request -> Response` function
 * the route test can drive with no Next request scope.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const body: unknown = await req.json().catch(() => null);
  const userAgent = req.headers.get("user-agent") ?? undefined;
  const ip = clientIp(req);

  return runWithContext(
    { requestId: randomUUID(), actorId: null },
    async (): Promise<Response> => {
      const parsed = redeemInviteBody.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "invalid" }, { status: 400 });
      }

      let userId: string;
      try {
        ({ userId } = await runInTransaction((tx) =>
          redeemInvite(tx, {
            rawToken: token,
            name: parsed.data.name,
            password: parsed.data.password,
          }),
        ));
      } catch (e) {
        if (e instanceof GoneError) {
          return NextResponse.json({ error: "gone" }, { status: 410 });
        }
        throw e;
      }

      const session = await createSession(userId, { userAgent, ip });
      const res = NextResponse.json({ ok: true });
      res.cookies.set(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        expires: session.expires,
        path: "/",
      });
      return res;
    },
  );
}

/** First hop of `x-forwarded-for`, else a placeholder (see `rate-limit.ts` on
 *  trusting XFF). Mirrors the login route. */
function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "local"
  );
}
