import { randomBytes } from "node:crypto";
import { authDb } from "./db";

/**
 * Server-side sessions — the whole of Keel's session handling.
 *
 * `specs/00-foundation.md` §3.2: Auth.js v5 cannot issue a database session for
 * a credentials sign-in, so this module owns it instead. An opaque 32-byte
 * token lives in the `authjs.session-token` cookie and indexes one `Session`
 * row; nothing else authorises a request. No JWT branch exists in the codebase.
 *
 * The cookie name stays `authjs.session-token` so a later move back to Auth.js
 * (once it can persist a credentials session) does not invalidate live cookies.
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** The session cookie name. Read by the login route and by middleware. */
export const SESSION_COOKIE = "authjs.session-token";

/** 30-day session lifetime, slid forward by `touchSession`. */
export const SESSION_MAX_AGE_MS = THIRTY_DAYS_MS;

export async function createSession(
  userId: string,
  meta?: { userAgent?: string; ip?: string },
): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + THIRTY_DAYS_MS);
  await authDb().session.create({
    data: {
      sessionToken: token,
      userId,
      expires,
      userAgent: meta?.userAgent,
      ip: meta?.ip,
    },
  });
  return { token, expires };
}

/**
 * Resolve a cookie token to its session and user, or `null`. Expired sessions
 * and deactivated users both resolve to `null` — deactivating a user kills
 * their live sessions without a separate sweep.
 */
export async function getSessionAndUser(token: string) {
  const session = await authDb().session.findUnique({
    where: { sessionToken: token },
    include: { user: true },
  });
  if (!session || session.expires < new Date() || !session.user.isActive) {
    return null;
  }
  return { session, user: session.user };
}

/** Idempotent — a token that is already gone is not an error. */
export async function destroySession(token: string): Promise<void> {
  await authDb().session.deleteMany({ where: { sessionToken: token } });
}

/** Sliding expiry: push `expires` back out to the full window and record the
 *  hit. `updateMany` so a stale token is a no-op rather than a throw. */
export async function touchSession(token: string): Promise<void> {
  await authDb().session.updateMany({
    where: { sessionToken: token },
    data: {
      lastSeenAt: new Date(),
      expires: new Date(Date.now() + THIRTY_DAYS_MS),
    },
  });
}
