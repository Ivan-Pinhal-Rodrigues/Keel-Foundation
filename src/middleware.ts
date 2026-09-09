import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/http/cookies";

/**
 * Edge middleware: mint a request id, gate everything that is not public.
 *
 * Runs on the Edge runtime — no Prisma, no `node:*`. It deliberately does NOT
 * resolve the session (that needs the database); it only checks whether a
 * session cookie is *present*. The real session → actor resolution, plus
 * `touchSession` and the audit/context wiring, happens in `withRequest`
 * (`src/lib/api/with-request.ts`), which runs on the Node runtime inside every
 * route handler and reads back the `x-request-id` this sets.
 *
 * `crypto.randomUUID()` is the Web Crypto global (Edge-safe) — not
 * `node:crypto`.
 */

const PUBLIC = [
  /^\/api\/healthz$/,
  /^\/api\/readyz$/,
  /^\/api\/metrics$/,
  /^\/api\/auth\/login$/,
  /^\/api\/guest-invites\/[^/]+\/redeem$/,
  /^\/login$/,
  /^\/portal\/invite\//,
  // `/dev/*` (the component gallery) is an unauthenticated build-time surface in
  // local dev and test. In production it does not exist — the guard in
  // `middleware()` 404s it before this list is consulted — so the entry is added
  // only outside production, never as a public route in a prod build.
  ...(process.env.NODE_ENV !== "production" ? [/^\/dev\//] : []),
];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const requestId = crypto.randomUUID();

  // `/dev/*` is dev/test-only. In production it must look unrouted: a bare 404,
  // returned before the PUBLIC / cookie check, still carrying `x-request-id` so
  // logs correlate.
  if (process.env.NODE_ENV === "production" && pathname.startsWith("/dev/")) {
    const notFound = new NextResponse("Not Found", { status: 404 });
    notFound.headers.set("x-request-id", requestId);
    return notFound;
  }

  const allowed =
    PUBLIC.some((re) => re.test(pathname)) || req.cookies.has(SESSION_COOKIE);

  let res: NextResponse;
  if (allowed) {
    // Forward the id on the request so `withRequest` sees the same one, and set
    // it on the response for the client / logs.
    const headers = new Headers(req.headers);
    headers.set("x-request-id", requestId);
    res = NextResponse.next({ request: { headers } });
  } else if (pathname.startsWith("/api/")) {
    res = NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  } else {
    // req.url reflects the app's own bind address, not what the client
    // actually sees — behind a reverse proxy (nginx terminating TLS on a
    // different public port than the app's internal bind) that produces a
    // redirect the browser can never reach. Build the origin from the
    // request's own headers instead: X-Forwarded-* when a proxy set them,
    // falling back to the plain Host header for a direct connection.
    const host =
      req.headers.get("x-forwarded-host") ??
      req.headers.get("host") ??
      req.nextUrl.host;
    const proto =
      req.headers.get("x-forwarded-proto") ??
      req.nextUrl.protocol.replace(":", "");
    res = NextResponse.redirect(
      new URL(
        `/login?next=${encodeURIComponent(pathname)}`,
        `${proto}://${host}`,
      ),
    );
  }

  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"],
};
