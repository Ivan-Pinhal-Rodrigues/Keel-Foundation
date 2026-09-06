import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "@/server/audit/write";
import { runWithContext } from "@/server/context";
import { prisma } from "@/server/db/client";
import { logger } from "@/server/log";
import { emitNotification } from "@/server/modules/notify/emit";

/**
 * The overdue sweep (spec 02 §3).
 *
 * `Incident.overdue` is a stored, indexed boolean kept honest here:
 *  1. It is cleared for any incident that is no longer overdue-eligible
 *     (`RESOLVED` / `CLOSED`).
 *  2. It is set — with one `incident.overdue` audit event and one `OVERDUE`
 *     notification to every internal user — the first time an open incident
 *     crosses its `dueAt`. `overdueNotifiedAt IS NULL` in the find, plus the
 *     stamp in the update, makes that fire exactly once per incident.
 *
 * Each incident is flagged in its own transaction + request context so
 * `writeAudit` has a `requestId`; a system action carries `actorId: null`.
 *
 * `db` defaults to the app singleton; tests pass a disposable-schema client.
 * The per-incident transaction runs on `db.$transaction` directly (as the
 * outbox worker does) rather than `runInTransaction`, so a test client is
 * honoured end to end.
 */

export async function sweepOverdueIncidents(deps?: {
  now?: () => Date;
  db?: PrismaClient;
}): Promise<{ flagged: number; cleared: number }> {
  const db = deps?.db ?? prisma;
  const now = deps?.now?.() ?? new Date();

  // Clear the stored flag for anything no longer overdue: terminal now, or
  // re-categorised so `dueAt` has moved back into the future.
  const cleared = await db.incident.updateMany({
    where: {
      overdue: true,
      OR: [{ status: { in: ["RESOLVED", "CLOSED"] } }, { dueAt: { gte: now } }],
    },
    data: { overdue: false },
  });

  const due = await db.incident.findMany({
    where: {
      status: { notIn: ["RESOLVED", "CLOSED"] },
      dueAt: { lt: now },
      overdueNotifiedAt: null,
    },
    select: { id: true, ref: true, title: true },
  });

  for (const inc of due) {
    await runWithContext({ requestId: `sweep-${inc.id}`, actorId: null }, () =>
      db.$transaction(async (tx) => {
        await tx.incident.update({
          where: { id: inc.id },
          data: { overdue: true, overdueNotifiedAt: now },
        });
        await writeAudit(tx, {
          actorId: null,
          action: "incident.overdue",
          subjectType: "Incident",
          subjectId: inc.id,
          payload: {},
        });
        // `ALL_INTERNAL` covers the assignee, who is internal — one `OVERDUE`
        // notification per internal user (spec 02 §3).
        await emitNotification(tx, {
          recipients: { audience: "ALL_INTERNAL" },
          kind: "OVERDUE",
          subjectType: "Incident",
          subjectId: inc.id,
          summary: `${inc.ref} is overdue: ${inc.title}`,
        });
      }),
    );
  }

  return { flagged: due.length, cleared: cleared.count };
}

/**
 * Start the polling loop — one per process, guarded on `globalThis`, mirroring
 * `startOutboxWorker` in `src/server/modules/notify/worker.ts`.
 */
export function startOverdueSweeper(): void {
  const g = globalThis as unknown as { __keelOverdueSweeper?: NodeJS.Timeout };
  if (g.__keelOverdueSweeper) return;
  const OVERDUE_POLL_MS = Number(process.env.OVERDUE_POLL_MS ?? 60_000);
  g.__keelOverdueSweeper = setInterval(() => {
    sweepOverdueIncidents().catch((e) =>
      logger.error({ err: e }, "overdue sweep failed"),
    );
  }, OVERDUE_POLL_MS);
  logger.info({ pollMs: OVERDUE_POLL_MS }, "overdue sweeper started");
}
