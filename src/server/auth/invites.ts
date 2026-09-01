import { createHash, randomBytes } from "node:crypto";
import { writeAudit } from "@/server/audit/write";
import { hashPassword } from "@/server/auth/password";
import { prisma } from "@/server/db/client";
import type { PrismaTransaction } from "@/server/db/tx";
import { isInternal } from "@/server/policy/actor";
import type { Actor } from "@/server/policy/actor";
import { ForbiddenError, GoneError } from "@/server/policy/errors";

/**
 * Guest invites — an internal user invites someone from a client organisation
 * to the portal. `specs/00-foundation.md` §3.3, `specs/07-guest-portal.md` §4.1.
 *
 * The invite token is 32 bytes of CSPRNG output, base64url, and travels in a
 * URL that lands in the invitee's inbox — so it is **hashed at rest** (same
 * reasoning as session tokens, `session.ts`): `GuestInvite.token` stores the
 * SHA-256, every lookup hashes its argument first. The raw token is returned
 * once, in the redeem URL, and never stored.
 *
 * `createInvite` and `redeemInvite` take the transaction first — the invite
 * write and its audit row commit or roll back together. `clientForInviteToken`
 * is a read, so it takes an optional trailing client and defaults to the
 * singleton.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Hex SHA-256. The stored `GuestInvite.token` is `sha256(rawToken)`; no salt
 *  is needed for a 32-byte CSPRNG input, and it must stay deterministic to be a
 *  unique-index equality lookup. */
export const sha256 = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

/**
 * Create an invite for `email` to join `clientId`'s portal. Any internal actor
 * may; a guest gets `ForbiddenError` (→ 403). Emits `guest_invite.created`.
 * Returns the redeem URL carrying the raw (unhashed) token.
 */
export async function createInvite(
  actor: Actor,
  tx: PrismaTransaction,
  input: { clientId: string; email: string },
): Promise<{ url: string }> {
  if (!isInternal(actor)) throw new ForbiddenError("internal users only");

  const raw = randomBytes(32).toString("base64url");
  const invite = await tx.guestInvite.create({
    data: {
      token: sha256(raw),
      clientId: input.clientId,
      email: input.email,
      createdById: actor.id,
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
    },
  });

  await writeAudit(tx, {
    actorId: actor.id,
    action: "guest_invite.created",
    subjectType: "GuestInvite",
    subjectId: invite.id,
    payload: { clientId: input.clientId, email: input.email },
  });

  return { url: `${process.env.APP_URL}/portal/invite/${raw}` };
}

/**
 * Read-only: the inviting client's name for a raw token, or `null` if the
 * invite is unknown, expired, or already redeemed. The invite-redemption page
 * renders from this; it never consumes the invite.
 */
export async function clientForInviteToken(
  rawToken: string,
  client: PrismaTransaction = prisma,
): Promise<{ clientName: string } | null> {
  const invite = await client.guestInvite.findUnique({
    where: { token: sha256(rawToken) },
    select: {
      redeemedAt: true,
      expiresAt: true,
      client: { select: { name: true } },
    },
  });

  if (!invite || invite.redeemedAt !== null || invite.expiresAt < new Date()) {
    return null;
  }
  return { clientName: invite.client.name };
}

/** Postgres unique-constraint violation, without importing the Prisma error
 *  type (the `@prisma/client` import is confined to `src/server/db/**`). */
const isUniqueViolation = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  "code" in e &&
  (e as { code?: unknown }).code === "P2002";

/**
 * Redeem a raw invite token: create the scoped `GUEST` user, mark the invite
 * used, log them in (the route sets the cookie). Emits `guest_invite.redeemed`
 * with the new user as the actor. Runs inside the caller's transaction, so the
 * guarded consume, the `User` create, and the audit row commit as one.
 *
 * An unknown, expired, or already-redeemed token is `GoneError` (→ 410); so is
 * an invite whose email already has an account. Two calls racing one valid
 * token are ordered by the guarded `updateMany` that consumes the invite —
 * exactly one matches a row, the loser gets `GoneError` — not by the
 * `User.email` unique index. That index's violation is still caught, now only
 * as the backstop for a same-email race across two different invites.
 */
export async function redeemInvite(
  tx: PrismaTransaction,
  input: { rawToken: string; name: string; password: string },
): Promise<{ userId: string }> {
  const now = new Date();
  const invite = await tx.guestInvite.findUnique({
    where: { token: sha256(input.rawToken) },
  });
  if (!invite || invite.redeemedAt !== null || invite.expiresAt < now) {
    throw new GoneError("invite is unknown, expired, or already redeemed");
  }

  const existing = await tx.user.findUnique({
    where: { email: invite.email },
    select: { id: true },
  });
  if (existing) throw new GoneError("an account already exists for this email");

  // Consume the invite before building the account, with a write that claims
  // the row and asserts it claimed exactly one. Two calls racing one token both
  // clear the reads above; this `updateMany` is the arbiter — the loser matches
  // zero rows (its `redeemedAt IS NULL` no longer holds once the winner
  // commits) and fails fast here, with no half-built account to roll back. The
  // check above stays the fast path for the plainly-spent cases.
  const consumed = await tx.guestInvite.updateMany({
    where: { id: invite.id, redeemedAt: null },
    data: { redeemedAt: now },
  });
  if (consumed.count !== 1) throw new GoneError("invite already redeemed");

  const passwordHash = await hashPassword(input.password);

  let user: { id: string };
  try {
    user = await tx.user.create({
      data: {
        email: invite.email,
        passwordHash,
        kind: "GUEST",
        hats: [],
        displayName: input.name,
        clientId: invite.clientId,
      },
      select: { id: true },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new GoneError("an account already exists for this email");
    }
    throw e;
  }

  await writeAudit(tx, {
    actorId: user.id,
    action: "guest_invite.redeemed",
    subjectType: "GuestInvite",
    subjectId: invite.id,
  });

  return { userId: user.id };
}
