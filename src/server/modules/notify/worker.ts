import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logger } from "@/server/log";
import { renderTemplate } from "./templates";
import { nodemailerTransport, type Transport } from "./transport";

/**
 * The email outbox worker (spec 05 §6).
 *
 * One tick = one `$transaction`:
 *  1. `pg_try_advisory_xact_lock` so exactly one sender runs across replicas —
 *     the xact-scoped lock releases automatically at commit/rollback, no manual
 *     unlock, no lock leak if the tick throws.
 *  2. Claim the due `PENDING` rows `FOR UPDATE SKIP LOCKED`.
 *  3. Render + send each; on success mark `SENT`, on failure bump `attempts`
 *     with an exponential backoff, giving up (`FAILED`) at 6 attempts.
 *
 * `runOutboxOnce` never throws — a bad tick is logged and the accumulated
 * counts are returned.
 */

/** Retry backoff: `min(2^attempts, 30)` minutes, in milliseconds. */
export function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 30) * 60_000;
}

type ClaimedRow = {
  id: string;
  toEmail: string;
  template: string;
  payload: unknown;
  attempts: number;
};

type OutboxCounts = { sent: number; failed: number; deferred: number };

export async function runOutboxOnce(deps: {
  transport: Transport;
  now?: () => Date;
  // Defaults to the app singleton; tests pass the disposable-schema client.
  // Typed as PrismaClient (not the union with PrismaTransaction) because the
  // tick opens its own `$transaction`, which a TransactionClient cannot do.
  db?: PrismaClient;
}): Promise<OutboxCounts> {
  const db = deps.db ?? prisma;
  const now = (deps.now ?? (() => new Date()))();
  let counts: OutboxCounts = { sent: 0, failed: 0, deferred: 0 };

  try {
    counts = await db.$transaction(async (t) => {
      const lock = await t.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext('keel:outbox')) AS locked
      `;
      if (!lock[0]?.locked) return { sent: 0, failed: 0, deferred: 0 };

      const claimed = await t.$queryRaw<ClaimedRow[]>`
        SELECT id, "toEmail", template, payload, attempts
        FROM "EmailOutbox"
        WHERE status = 'PENDING' AND "nextAttemptAt" <= ${now}
        FOR UPDATE SKIP LOCKED
      `;

      let sent = 0;
      let failed = 0;

      for (const row of claimed) {
        try {
          const rendered = renderTemplate(
            row.template,
            (row.payload ?? {}) as Record<string, unknown>,
          );
          await deps.transport.send({
            to: row.toEmail,
            subject: rendered.subject,
            text: rendered.text,
            html: rendered.html,
          });
          await t.emailOutbox.update({
            where: { id: row.id },
            data: { status: "SENT", sentAt: now },
          });
          sent += 1;
        } catch (err) {
          const attempts = row.attempts + 1;
          if (attempts >= 6) {
            await t.emailOutbox.update({
              where: { id: row.id },
              data: { status: "FAILED", attempts, lastError: String(err) },
            });
            failed += 1;
          } else {
            await t.emailOutbox.update({
              where: { id: row.id },
              data: {
                status: "PENDING",
                attempts,
                lastError: String(err),
                nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
              },
            });
          }
        }
      }

      const deferredRows = await t.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM "EmailOutbox"
        WHERE status = 'PENDING' AND "nextAttemptAt" > ${now}
      `;

      return { sent, failed, deferred: deferredRows[0]?.count ?? 0 };
    });
  } catch (err) {
    logger.error({ err }, "outbox tick failed");
  }

  return counts;
}

/**
 * Start the polling loop — one per process, guarded on `globalThis`. The real
 * transport is constructed lazily inside the interval callback so importing or
 * calling this never touches SMTP.
 */
export function startOutboxWorker(): void {
  const g = globalThis as unknown as { __keelOutbox?: NodeJS.Timeout };
  if (g.__keelOutbox) return;
  g.__keelOutbox = setInterval(
    () => {
      runOutboxOnce({ transport: nodemailerTransport() }).catch((e) =>
        logger.error({ err: e }, "outbox worker tick rejected"),
      );
    },
    Number(process.env.NOTIFY_POLL_MS ?? 5000),
  );
}
