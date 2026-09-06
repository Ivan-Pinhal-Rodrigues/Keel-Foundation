import type { $Enums } from "@prisma/client";
import { ForbiddenError } from "@/server/policy/errors";

/**
 * The incident lifecycle state machine (spec 02 §4). Pure — no Prisma, no I/O.
 * `NEW → ASSIGNED` is driven by `assignIncident`; `ASSIGNED → IN_PROGRESS`,
 * `IN_PROGRESS → RESOLVED`, `RESOLVED → CLOSED` by `transitionIncident`;
 * `RESOLVED → IN_PROGRESS` and `CLOSED → IN_PROGRESS` by `reopenIncident` (the
 * latter only within `REOPEN_WINDOW_MS`, checked in the service).
 */
export const INCIDENT_TRANSITIONS: Record<
  $Enums.IncidentStatus,
  readonly $Enums.IncidentStatus[]
> = {
  NEW: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["IN_PROGRESS"],
};

/** Throw `ForbiddenError` unless `from → to` is a declared transition. */
export function assertTransition(
  from: $Enums.IncidentStatus,
  to: $Enums.IncidentStatus,
): void {
  if (!INCIDENT_TRANSITIONS[from].includes(to)) {
    throw new ForbiddenError(`illegal incident transition: ${from} -> ${to}`);
  }
}

/** A `CLOSED` incident may be reopened only within 14 days of `closedAt`. */
export const REOPEN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
