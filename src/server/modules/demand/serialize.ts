import type { $Enums } from "@prisma/client";
import { type Actor } from "@/server/policy/actor";
import { serializePick } from "@/server/policy/serialize";

/**
 * Role-aware view of one demand row (`plans/plan-01-demand.md`, spec 01 §5).
 *
 * `DEMAND_GUEST_KEYS` is an ALLOWLIST: a guest sees only these keys plus the
 * `guestTransform` output. A column added to the row later stays hidden from a
 * guest until it is deliberately added here — it cannot leak by omission. An
 * internal reader gets the whole row unchanged.
 */

export const DEMAND_GUEST_KEYS = [
  "id",
  "ref",
  "title",
  "problem",
  "source",
  "affectedService",
  "createdAt",
] as const;

/**
 * The guest-facing status phrase (spec 01 §5). `rejectionReason` is
 * `Demand.rejectionReason` — plan-01 Task 4 adds that column; until then it
 * arrives as `null` / `undefined` and REJECTED reads as a bare "Declined".
 */
export function guestStatusLabel(
  status: $Enums.DemandStatus,
  decision: $Enums.WorthDecision | null,
  rejectionReason: string | null,
  linkedChangeStatus?: $Enums.ChangeStatus | null,
): string {
  switch (status) {
    case "SUBMITTED":
    case "TRIAGING":
    case "WORTH_ASSESSED":
      return "In review";
    case "APPROVED":
      return decision === "PURSUE" ? "Approved" : "In review";
    case "CONVERTED":
      // plan-03: the guest follows the linked Change — "Delivered" once it has
      // closed, "In progress" while the work is still under way.
      return linkedChangeStatus === "CLOSED" ? "Delivered" : "In progress";
    case "REJECTED":
      return rejectionReason ? `Declined — ${rejectionReason}` : "Declined";
  }
}

/** `Demand` + `worth: WorthAssessment | null` + `client: { name } | null`. */
type DemandWithWorth = Record<string, unknown>;

export function serializeDemand(
  actor: Actor,
  row: DemandWithWorth,
): Record<string, unknown> {
  return serializePick(actor, row, {
    guestKeys: DEMAND_GUEST_KEYS,
    guestTransform: (r) => ({
      status: guestStatusLabel(
        r.status as $Enums.DemandStatus,
        (r.worth as { decision?: $Enums.WorthDecision } | null)?.decision ??
          null,
        (r.rejectionReason as string | null | undefined) ?? null,
        (r.convertedToChange as { status: $Enums.ChangeStatus } | null)
          ?.status ?? null,
      ),
      clientName: (r.client as { name: string } | null)?.name ?? null,
    }),
  });
}
