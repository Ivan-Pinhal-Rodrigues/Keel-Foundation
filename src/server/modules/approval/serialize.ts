import { type Actor } from "@/server/policy/actor";
import type { ApprovalStateView } from "./service";

/**
 * Actor-aware view of the approval panel (spec 04 §7).
 *
 * `needsOverride` is the single-approver escape hatch: the current step wants a
 * hat the actor holds, but the actor is the change owner, so a normal approval
 * is a separation-of-duties violation and the UI must offer the override path.
 */
export type ApprovalPanelView = ApprovalStateView & { needsOverride: boolean };

export function serializeApprovalState(
  state: ApprovalStateView,
  actor: Actor,
): ApprovalPanelView {
  const needsOverride =
    state.currentStep != null &&
    actor.hats.includes(state.currentStep.requiredHat) &&
    actor.id === state.createdById;
  return { ...state, needsOverride };
}
