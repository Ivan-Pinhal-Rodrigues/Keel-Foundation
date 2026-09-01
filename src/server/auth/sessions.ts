import type {
  AdminSessionListItem,
  SessionListItem,
} from "@/lib/api/schemas/sessions";
import { writeAudit } from "@/server/audit/write";
import { destroySession } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { runInTransaction } from "@/server/db/tx";
import { hasHat } from "@/server/policy/actor";
import type { Actor } from "@/server/policy/actor";

/**
 * The Prisma + audit work behind the session routes (Task 15). Route handlers
 * live under `src/app/**` and may not import a Prisma client, so everything that
 * touches `Session` rows — reads, the serialiser, the revoke, and logout's
 * `auth.logout` emit — lives here and the routes stay thin.
 *
 * Serialisation is deliberate: a returned row never carries `sessionToken`
 * (which is only a hash anyway — see `session.ts`).
 */

// The columns a user may see about a session. Note the absence of sessionToken.
const SAFE_COLUMNS = {
  id: true,
  createdAt: true,
  lastSeenAt: true,
  userAgent: true,
  ip: true,
  expires: true,
} as const;

/** The caller's own sessions, most-recently-active first. */
export function listSessionsFor(actor: Actor): Promise<SessionListItem[]> {
  return prisma.session.findMany({
    where: { userId: actor.id },
    select: SAFE_COLUMNS,
    orderBy: { lastSeenAt: "desc" },
  });
}

/** Every session with its owning user — the `?all=1` view for a
 *  `TECHNICAL_APPROVER`. */
export function listAllSessions(): Promise<AdminSessionListItem[]> {
  return prisma.session.findMany({
    select: {
      ...SAFE_COLUMNS,
      userId: true,
      user: { select: { email: true, displayName: true } },
    },
    orderBy: { lastSeenAt: "desc" },
  });
}

/** `{ ok: false }` means "no such session, or not yours to revoke" — the route
 *  answers 404 for both so existence is never revealed. */
export type RevokeResult = { ok: true } | { ok: false };

/**
 * Revoke session `id`.
 *
 *  - the caller's own            → deleted, `session.revoked` `self: true`
 *  - another's + caller is TECH  → deleted, `session.revoked` `self: false`
 *  - another's + caller not TECH → `{ ok: false }`
 *  - no such session             → `{ ok: false }`
 *
 * The find, the authorization check, the delete, and the `session.revoked`
 * event all share one transaction.
 */
export function revokeSession(id: string, actor: Actor): Promise<RevokeResult> {
  return runInTransaction<RevokeResult>(async (tx) => {
    const target = await tx.session.findUnique({
      where: { id },
      select: { userId: true },
    });

    const isOwn = target?.userId === actor.id;
    if (!target || (!isOwn && !hasHat(actor, "TECHNICAL_APPROVER"))) {
      return { ok: false };
    }

    await tx.session.delete({ where: { id } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "session.revoked",
      subjectType: "Session",
      subjectId: id,
      payload: { targetUserId: target.userId, self: isOwn },
    });
    return { ok: true };
  });
}

/**
 * Log the caller out: drop the session row (if any) and emit `auth.logout`
 * (`specs/00-foundation.md` §3.4), atomically. Idempotent — a missing token or
 * an already-dead session still writes the audit row.
 */
export function logout(
  actorId: string | null,
  token: string | null,
): Promise<void> {
  return runInTransaction(async (tx) => {
    if (token) await destroySession(token, tx);
    await writeAudit(tx, {
      actorId,
      action: "auth.logout",
      subjectType: "User",
      subjectId: actorId ?? "unknown",
    });
  });
}
