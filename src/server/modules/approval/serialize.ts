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
  // A resolved request (REJECTED / APPROVED / CANCELLED) must never surface a
  // "current step" or an override prompt: `getApprovalState` computes
  // `currentStep` from the first PENDING step, and a two-step request rejected
  // at step 1 leaves step 2 PENDING. Only a PENDING request has a live step.
  if (state.status !== "PENDING") {
    return { ...state, currentStep: null, needsOverride: false };
  }
  const needsOverride =
    state.currentStep != null &&
    actor.hats.includes(state.currentStep.requiredHat) &&
    actor.id === state.createdById;
  return { ...state, needsOverride };
}
