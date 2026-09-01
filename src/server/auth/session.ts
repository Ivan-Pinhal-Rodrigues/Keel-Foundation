import { createHash, randomBytes } from "node:crypto";
import type { PrismaTransaction } from "@/server/db/tx";
import { prisma } from "@/server/db/client";

/**
 * Server-side sessions — the whole of Keel's session handling.
 *
 * `specs/00-foundation.md` §3.2: Auth.js v5 cannot issue a database session for
 * a credentials sign-in, so this module owns it instead. An opaque 32-byte
 * token lives in the `authjs.session-token` cookie and indexes one `Session`
 * row; nothing else authorises a request. No JWT branch exists in the codebase.
 *
 * The token is **hashed at rest**: the cookie carries the raw token, the
 * `Session.sessionToken` column stores its SHA-256. Anyone who reads the table
 * — SQL injection, a backup, a replica — gets digests they cannot present as
 * cookies. Every lookup below hashes its argument first.
 *
 * Each function takes an optional trailing `client` so a caller can run inside
 * a `$transaction` (the login route creates the session and its audit event
 * together) or against the integration harness's disposable schema. It
 * defaults to the app singleton.
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** The session cookie name. Read by the login route and by middleware. */
export const SESSION_COOKIE = "authjs.session-token";

/** 30-day session lifetime, slid forward by `touchSession`. */
export const SESSION_MAX_AGE_MS = THIRTY_DAYS_MS;

/**
 * How a raw cookie token maps to the stored `sessionToken`.
 *
 * Unsalted SHA-256 is right here and a salt would add nothing: the input is 32
 * bytes of CSPRNG output, so there is no dictionary to precompute and no
 * cross-user correlation to hide. (Contrast passwords, which are low-entropy
 * and therefore argon2id — see `password.ts`.) It also has to stay a plain
 * deterministic function so `sessionToken` remains a unique-indexed equality
 * lookup rather than a table scan.
 */
const digest = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export async function createSession(
  userId: string,
  meta?: { userAgent?: string; ip?: string },
  client: PrismaTransaction = prisma,
): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + THIRTY_DAYS_MS);
  await client.session.create({
    data: {
      sessionToken: digest(token),
      userId,
      expires,
      userAgent: meta?.userAgent,
      ip: meta?.ip,
    },
  });
  // The raw token is returned once, for the cookie, and never stored.
  return { token, expires };
}

/**
 * Resolve a cookie token to its session and user, or `null`. Expired sessions
 * and deactivated users both resolve to `null` — deactivating a user kills
 * their live sessions without a separate sweep.
 */
export async function getSessionAndUser(
  token: string,
  client: PrismaTransaction = prisma,
) {
  const session = await client.session.findUnique({
    where: { sessionToken: digest(token) },
    include: { user: true },
  });
  if (!session || session.expires < new Date() || !session.user.isActive) {
    return null;
  }
  return { session, user: session.user };
}

/** Idempotent — a token that is already gone is not an error. */
export async function destroySession(
  token: string,
  client: PrismaTransaction = prisma,
): Promise<void> {
  await client.session.deleteMany({ where: { sessionToken: digest(token) } });
}

/**
 * Sliding expiry: push `expires` back out to the full window and record the
 * hit.
 *
 * The `expires: { gt: now }` guard is load-bearing — without it, touching an
 * expired-but-unswept row would resurrect a dead session, so the ordering of
 * "check the session" and "touch the session" in a caller would become a
 * security property. With it, an expired row can never be revived by any call
 * order. `updateMany` so an unknown token is a no-op rather than a throw.
 */
export async function touchSession(
  token: string,
  client: PrismaTransaction = prisma,
): Promise<void> {
  const now = new Date();
  await client.session.updateMany({
    where: { sessionToken: digest(token), expires: { gt: now } },
    data: {
      lastSeenAt: now,
      expires: new Date(now.getTime() + THIRTY_DAYS_MS),
    },
  });
}
