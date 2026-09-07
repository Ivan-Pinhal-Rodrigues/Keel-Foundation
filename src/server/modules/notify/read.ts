import type { $Enums, PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { Actor } from "@/server/policy/actor";

/**
 * The notification read side — the counterpart to `emit.ts`. `emitNotification`
 * writes the rows (on the triggering write's transaction); these functions read
 * them back for the bell menu and the mark-read actions.
 *
 * Every query is scoped by `userId: actor.id` and nothing else. A notification
 * belongs to exactly one user, so there is no client scope and no `authorize`
 * call here — the route does the `notification.view.own` formality, and a user
 * physically cannot address another user's rows. Reads take a trailing
 * `client: PrismaClient = prisma`, matching the incident module.
 */

export type NotificationView = {
  id: string;
  kind: $Enums.NotificationKind;
  subjectType: string;
  subjectId: string;
  summary: string;
  href: string;
  createdAt: string; // ISO
  readAt: string | null; // ISO or null
};

/**
 * The deep-link target for a notification. `subjectType` arrives in mixed case
 * across the codebase ("Demand" vs "demand", "Incident" vs "incident"), so it is
 * lower-cased before matching. A guest only ever sees demands and incidents —
 * anything else lands them on the portal home.
 */
export function hrefFor(
  subjectType: string,
  subjectId: string,
  actorKind: $Enums.UserKind,
): string {
  const type = subjectType.toLowerCase();

  if (actorKind === "GUEST") {
    if (type === "demand") return `/portal/demands/${subjectId}`;
    if (type === "incident") return `/portal/incidents/${subjectId}`;
    return "/portal";
  }

  if (type === "demand") return `/demands?open=${subjectId}`;
  if (type === "incident") return `/incidents?open=${subjectId}`;
  if (type === "change") return `/changes?open=${subjectId}`;
  if (type === "approvalrequest") return "/approvals";
  return "/overview";
}

type NotificationRow = {
  id: string;
  kind: $Enums.NotificationKind;
  subjectType: string;
  subjectId: string;
  payload: unknown;
  createdAt: Date;
  readAt: Date | null;
};

/** Map a stored row to its API view: pull the rendered sentence out of the
 * JSON `payload` (`emitNotification` writes `{ summary, subjectType, subjectId }`),
 * add the deep link, and render the dates as ISO strings. */
function serializeNotification(
  row: NotificationRow,
  actorKind: $Enums.UserKind,
): NotificationView {
  const summary = (row.payload as { summary?: unknown } | null)?.summary;
  return {
    id: row.id,
    kind: row.kind,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    summary: typeof summary === "string" ? summary : "",
    href: hrefFor(row.subjectType, row.subjectId, actorKind),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

export async function listNotifications(
  actor: Actor,
  filters: { unread?: boolean; kind?: $Enums.NotificationKind },
  client: PrismaClient = prisma,
): Promise<NotificationView[]> {
  const rows = await client.notification.findMany({
    where: {
      userId: actor.id,
      ...(filters.unread ? { readAt: null } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
    },
    // `id` (a cuid, monotonic with insertion) is a stable tiebreaker so rows
    // written in the same millisecond — a single `createMany` — still come back
    // newest-first deterministically.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });
  return rows.map((row) => serializeNotification(row, actor.kind));
}

export async function unreadCount(
  actor: Actor,
  client: PrismaClient = prisma,
): Promise<number> {
  return client.notification.count({
    where: { userId: actor.id, readAt: null },
  });
}

/** One failed-delivery row for the dashboard's email-health card. */
export type FailedEmailRow = {
  toEmail: string;
  template: string;
  lastError: string | null;
  attempts: number;
};

/**
 * Failed `EmailOutbox` deliveries in the last 7 days — the count plus the 10
 * most recent, newest first. The dashboard overview composes this into its
 * `emailFailures` tile; keeping the `emailOutbox` read here (spec 05 §8 owns the
 * `EmailOutbox` table) lets `overview/service.ts` stay Prisma-free.
 */
export async function listFailedEmails(
  client: PrismaClient = prisma,
): Promise<{ count: number; recent: FailedEmailRow[] }> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const where = {
    status: "FAILED" as $Enums.OutboxStatus,
    updatedAt: { gte: since },
  };
  const [count, recent] = await Promise.all([
    client.emailOutbox.count({ where }),
    client.emailOutbox.findMany({
      where,
      take: 10,
      orderBy: { updatedAt: "desc" },
      select: {
        toEmail: true,
        template: true,
        lastError: true,
        attempts: true,
      },
    }),
  ]);
  return { count, recent };
}

export async function markRead(
  actor: Actor,
  input: { ids: string[] } | { all: true },
  client: PrismaClient = prisma,
): Promise<{ updated: number }> {
  const where =
    "all" in input
      ? { userId: actor.id, readAt: null }
      : { userId: actor.id, id: { in: input.ids }, readAt: null };
  const { count } = await client.notification.updateMany({
    where,
    data: { readAt: new Date() },
  });
  return { updated: count };
}
