import { expect, test } from "vitest";
import { serializeApprovalState } from "@/server/modules/approval/serialize";
import type { ApprovalStateView } from "@/server/modules/approval/service";
import type { Actor } from "@/server/policy/actor";

const actor: Actor = {
  id: "owner-1",
  kind: "INTERNAL",
  hats: ["TECHNICAL_APPROVER"],
  clientId: null,
};

/** A 2-step request rejected at step 1: step 2 is still PENDING, so the raw
 *  `currentStep` is non-null even though the request is resolved. */
function rejectedState(): ApprovalStateView {
  return {
    requestId: "req-1",
    status: "REJECTED",
    policyKey: "change.high_risk",
    createdById: "owner-1",
    steps: [
      {
        id: "s1",
        order: 1,
        requiredHat: "TECHNICAL_APPROVER",
        status: "REJECTED",
        decision: {
          actorId: "tech-9",
          actorName: "Tessa Tech",
          decision: "REJECTED",
          reason: "unsafe rollback plan",
          isSingleApproverOverride: false,
          overrideJustification: null,
          decidedAt: new Date().toISOString(),
        },
      },
      {
        id: "s2",
        order: 2,
        requiredHat: "BUSINESS_APPROVER",
        status: "PENDING",
        decision: null,
      },
    ],
    currentStep: { id: "s2", requiredHat: "BUSINESS_APPROVER" },
  };
}

test("serializeApprovalState nulls currentStep and needsOverride for a REJECTED request", () => {
  const view = serializeApprovalState(rejectedState(), actor);
  expect(view.status).toBe("REJECTED");
  expect(view.currentStep).toBeNull();
  expect(view.needsOverride).toBe(false);
  // The step list is untouched.
  expect(view.steps).toHaveLength(2);
});

test("serializeApprovalState leaves a PENDING request's currentStep intact", () => {
  const pending: ApprovalStateView = {
    ...rejectedState(),
    status: "PENDING",
    steps: [
      {
        id: "s1",
        order: 1,
        requiredHat: "TECHNICAL_APPROVER",
        status: "PENDING",
        decision: null,
      },
    ],
    currentStep: { id: "s1", requiredHat: "TECHNICAL_APPROVER" },
  };
  const view = serializeApprovalState(pending, actor);
  expect(view.currentStep).toEqual({
    id: "s1",
    requiredHat: "TECHNICAL_APPROVER",
  });
  // The actor holds the hat and is the creator → the override path is offered.
  expect(view.needsOverride).toBe(true);
});
