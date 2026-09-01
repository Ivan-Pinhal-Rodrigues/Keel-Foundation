/**
 * Cookie names and a `Request`-header cookie reader, shared between the Edge
 * middleware and Node-runtime code.
 *
 * Zero imports on purpose: `src/middleware.ts` runs on the Edge runtime and
 * cannot pull in `@/server/auth/session` (that module reaches Prisma and
 * `node:crypto`). `session.ts` re-exports `SESSION_COOKIE` from here so its
 * public API — `import { SESSION_COOKIE } from "@/server/auth/session"` — is
 * unchanged; this file is just the definition both sides can reach.
 */

/** The session cookie. Purpose-built auth kept the Auth.js name so a later move
 *  back would not invalidate live cookies (`specs/00-foundation.md` §3.2). */
export const SESSION_COOKIE = "authjs.session-token";

/**
 * Read one cookie value off a `Request`'s `Cookie` header, or `null`.
 *
 * For plain `Request` route handlers — `src/middleware.ts` uses
 * `NextRequest.cookies` instead. Values are `decodeURIComponent`'d to undo what
 * `NextResponse.cookies.set` does on the way out; the session token is
 * base64url so this is a no-op for it, but a cookie reader should not assume its
 * callers' encodings.
 *
 * A malformed percent-encoding (`decodeURIComponent` throws `URIError`) is
 * treated as no cookie — a client-supplied value is never worth throwing over,
 * and the caller then proceeds unauthenticated.
 */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(pair.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
