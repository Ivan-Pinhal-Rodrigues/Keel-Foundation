import type { $Enums } from "@prisma/client";

/** `dueAt` offsets from creation, per specs/data-model.md §"Incident". Tunable. */
export const SLA_HOURS: Record<$Enums.Priority, number> = {
  P1: 4,
  P2: 24,
  P3: 72,
  P4: 168,
};

/** A small rank so the matrix reads as arithmetic rather than a 3x3 lookup. */
const RANK: Record<$Enums.Level, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

/**
 * Impact x Urgency -> Priority (specs/data-model.md §"Incident"):
 *   H×H → P1
 *   H×M, M×H → P2
 *   H×L, M×M, L×H → P3
 *   M×L, L×M, L×L → P4
 * The sum of the two ranks (2..6) selects the band; the only nuance is that a
 * pair summing to 4 is always P3 (M×M, H×L, L×H) — a plain sum handles that.
 */
export function priorityFor(
  impact: $Enums.Level,
  urgency: $Enums.Level,
): $Enums.Priority {
  const sum = RANK[impact] + RANK[urgency];
  if (sum >= 6) return "P1";
  if (sum === 5) return "P2";
  if (sum === 4) return "P3";
  return "P4"; // sum of 2 or 3
}

export function dueAtFrom(priority: $Enums.Priority, createdAt: Date): Date {
  return new Date(createdAt.getTime() + SLA_HOURS[priority] * 60 * 60 * 1000);
}

const TERMINAL: ReadonlySet<$Enums.IncidentStatus> = new Set([
  "RESOLVED",
  "CLOSED",
]);

/** `now > dueAt AND status NOT IN (RESOLVED, CLOSED)` — spec §3. Exactly at
 *  `dueAt` is not yet overdue. */
export function isOverdue(
  row: { dueAt: Date; status: $Enums.IncidentStatus },
  now: Date,
): boolean {
  return now.getTime() > row.dueAt.getTime() && !TERMINAL.has(row.status);
}
