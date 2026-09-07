import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { auditActionLabel } from "./labels";

/**
 * The most recent audit events for the dashboard activity feed — newest first,
 * each carrying a human `label` (`auditActionLabel`). `at` is an ISO string; the
 * append-only `AuditEvent.at` column is the row's creation time.
 */
export async function recentEvents(
  limit: number,
  client: PrismaClient = prisma,
): Promise<
  {
    at: string;
    action: string;
    label: string;
    actorId: string | null;
    subjectType: string;
    subjectId: string;
  }[]
> {
  const rows = await client.auditEvent.findMany({
    orderBy: { at: "desc" },
    take: limit,
    select: {
      at: true,
      action: true,
      actorId: true,
      subjectType: true,
      subjectId: true,
    },
  });
  return rows.map((e) => ({
    at: e.at.toISOString(),
    action: e.action,
    label: auditActionLabel(e.action),
    actorId: e.actorId,
    subjectType: e.subjectType,
    subjectId: e.subjectId,
  }));
}
