import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db/client";

/**
 * User reads that a route or server component needs but must not run against the
 * Prisma client directly (the `@prisma/client` boundary — DESIGN.md §3.2). Kept
 * deliberately small: today just the assignee picker's list.
 */

/**
 * Every active internal user, id + display name only, ordered by name — the
 * source list for the incident drawer's assignee `<select>`
 * (`plans/plan-02-incident.md` Task 9).
 */
export async function listInternalUsers(
  client: PrismaClient = prisma,
): Promise<{ id: string; displayName: string }[]> {
  return client.user.findMany({
    where: { kind: "INTERNAL", isActive: true },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
}
