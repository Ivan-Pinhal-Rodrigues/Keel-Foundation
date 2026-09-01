import { createHash, randomBytes } from "node:crypto";
import { writeAudit } from "@/server/audit/write";
import { prisma } from "@/server/db/client";
import type { PrismaTransaction } from "@/server/db/tx";
import { isInternal } from "@/server/policy/actor";
import type { Actor } from "@/server/policy/actor";
import { ForbiddenError } from "@/server/policy/errors";

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
