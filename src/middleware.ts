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
  /^\/api\/auth\/login$/,
  /^\/login$/,
  /^\/portal\/invite\//,
];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const requestId = crypto.randomUUID();

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
    res = NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(pathname)}`, req.url),
    );
  }

  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"],
};
