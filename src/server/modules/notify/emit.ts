import type { Prisma } from "@prisma/client";
import type { PrismaTransaction } from "@/server/db/tx";
import type { NotificationSpec, Recipients } from "./types";

/**
 * `emitNotification` — the one way a domain write raises notifications
 * (spec 05 §3, spec 00 §7).
 *
 * It runs entirely on the caller's transaction `tx`: recipient resolution, the
 * `Notification` inserts, and the `EmailOutbox` inserts all commit or roll back
 * with the domain write that triggered them. A notification is never delivered
 * for a change that was undone. It takes no optional-`client` param (unlike
 * `src/server/auth/session.ts`) precisely because it is only ever called from
 * inside a service's transaction.
 *
 * No `AuditEvent` is written: notifications are derived from audited state
 * changes, not independent facts.
 */

type Recipient = { id: string; email: string };

/** Resolve a `Recipients` shape to concrete `{ id, email }` rows, using `tx`. */
async function resolveRecipients(
  tx: PrismaTransaction,
  recipients: Recipients,
): Promise<Recipient[]> {
  if ("userIds" in recipients) {
    // An id with no row is silently skipped — safer than an FK crash.
    return tx.user.findMany({
      where: { id: { in: recipients.userIds } },
      select: { id: true, email: true },
    });
  }
  if ("hat" in recipients) {
    return tx.user.findMany({
      where: {
        kind: "INTERNAL",
        isActive: true,
        hats: { has: recipients.hat },
      },
      select: { id: true, email: true },
    });
  }
  return tx.user.findMany({
    where: { kind: "INTERNAL", isActive: true },
    select: { id: true, email: true },
  });
}

export async function emitNotification(
  tx: PrismaTransaction,
  spec: NotificationSpec,
): Promise<void> {
  const resolved = await resolveRecipients(tx, spec.recipients);

  // Post-filter uniformly across all three recipient shapes: drop the acting
  // user, then de-dupe by id.
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const r of resolved) {
    if (r.id === spec.excludeActorId || seen.has(r.id)) continue;
    seen.add(r.id);
    recipients.push(r);
  }

  if (recipients.length === 0) return;

  await tx.notification.createMany({
    data: recipients.map((r) => ({
      userId: r.id,
      kind: spec.kind,
      subjectType: spec.subjectType,
      subjectId: spec.subjectId,
      payload: {
        summary: spec.summary,
        subjectType: spec.subjectType,
        subjectId: spec.subjectId,
      } satisfies Prisma.InputJsonObject,
    })),
  });

  if (spec.email) {
    const { template, payload } = spec.email;
    await tx.emailOutbox.createMany({
      data: recipients.map((r) => ({
        toEmail: r.email,
        template,
        payload: payload as Prisma.InputJsonObject,
        status: "PENDING" as const,
      })),
    });
  }
}
