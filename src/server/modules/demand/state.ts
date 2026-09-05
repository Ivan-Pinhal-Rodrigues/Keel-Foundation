import type { $Enums } from "@prisma/client";
import { ForbiddenError } from "@/server/policy/errors";

/**
 * The demand lifecycle state machine (`plans/plan-01-demand.md` Task 3,
 * reconciliation ruling 1). Pure — no Prisma, no I/O. This is the one place the
 * legal transitions and the worth-gate predicate live; the service calls in
 * here, it never re-derives them.
 *
 * `TRIAGING → WORTH_ASSESSED` is gated on `worthComplete` (businessValue +
 * effort + costOfDelay), NOT on a recorded decision — the spec §3 arrow text
 * "decision recorded" is an error, contradicted by the separate `/decision`
 * endpoint. `APPROVED → WORTH_ASSESSED` lets a parked demand be re-decided;
 * `APPROVED → CONVERTED` lands in plan-03.
 */
export const DEMAND_TRANSITIONS: Record<
  $Enums.DemandStatus,
  readonly $Enums.DemandStatus[]
> = {
  SUBMITTED: ["TRIAGING"],
  TRIAGING: ["WORTH_ASSESSED"],
  WORTH_ASSESSED: ["APPROVED", "REJECTED"],
  APPROVED: ["WORTH_ASSESSED", "CONVERTED"],
  REJECTED: [],
  CONVERTED: [],
};

/** Throw `ForbiddenError` unless `from → to` is a declared transition. */
export function assertTransition(
  from: $Enums.DemandStatus,
  to: $Enums.DemandStatus,
): void {
  if (!DEMAND_TRANSITIONS[from].includes(to)) {
    throw new ForbiddenError(`illegal demand transition: ${from} -> ${to}`);
  }
}

/**
 * The worth assessment is complete once a business-value narrative, an effort
 * sizing, and a cost-of-delay note are all present. This is the gate for the
 * implicit `TRIAGING → WORTH_ASSESSED` transition.
 */
export function worthComplete(w: {
  businessValue: string | null;
  effort: $Enums.Effort | null;
  costOfDelay: string | null;
}): boolean {
  return w.businessValue != null && w.effort != null && w.costOfDelay != null;
}
