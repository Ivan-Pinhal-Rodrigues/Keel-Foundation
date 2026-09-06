/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ApprovalPanel,
  type ApprovalPanelState,
} from "@/components/ApprovalPanel";
import { stubRadixEnv } from "@/test/dom";

stubRadixEnv();
afterEach(cleanup);

const now = new Date().toISOString();

function baseState(
  overrides: Partial<ApprovalPanelState> = {},
): ApprovalPanelState {
  return {
    status: "PENDING",
    steps: [
      {
        id: "s1",
        order: 1,
        requiredHat: "TECHNICAL_APPROVER",
        status: "PENDING",
        decision: null,
      },
      {
        id: "s2",
        order: 2,
        requiredHat: "BUSINESS_APPROVER",
        status: "PENDING",
        decision: null,
      },
    ],
    currentStep: { id: "s1", requiredHat: "TECHNICAL_APPROVER" },
    needsOverride: false,
    ...overrides,
  };
}

test("renders each step with its required hat and status", () => {
  render(
    <ApprovalPanel
      state={baseState()}
      viewer={{ id: "v1", hats: [] }}
      onDecision={vi.fn()}
    />,
  );
  expect(screen.getByText("TECHNICAL_APPROVER")).toBeTruthy();
  expect(screen.getByText("BUSINESS_APPROVER")).toBeTruthy();
  // Step order is surfaced.
  expect(screen.getByText(/Step 1/)).toBeTruthy();
  expect(screen.getByText(/Step 2/)).toBeTruthy();
});

test("a viewer holding the current step's hat (not the creator) sees Approve and Reject; calls onDecision with a reason", async () => {
  const user = userEvent.setup();
  const onDecision = vi.fn().mockResolvedValue(undefined);
  render(
    <ApprovalPanel
      state={baseState()}
      viewer={{ id: "tech-1", hats: ["TECHNICAL_APPROVER"] }}
      onDecision={onDecision}
    />,
  );
  const approve = screen.getByRole("button", { name: "Approve" });
  expect(approve).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();

  await user.click(approve);
  const reason = screen.getByLabelText(/reason/i);
  await user.type(reason, "looks safe to me");
  await user.click(screen.getByRole("button", { name: /confirm/i }));

  expect(onDecision).toHaveBeenCalledWith({
    decision: "APPROVED",
    reason: "looks safe to me",
  });
});

test("a viewer without the current step's hat sees neither Approve nor Reject", () => {
  render(
    <ApprovalPanel
      state={baseState()}
      viewer={{ id: "biz-1", hats: ["BUSINESS_APPROVER"] }}
      onDecision={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
});

test("the creator (needsOverride) sees Override & approve; confirm is disabled under 20 chars and passes overrideJustification", async () => {
  const user = userEvent.setup();
  const onDecision = vi.fn().mockResolvedValue(undefined);
  render(
    <ApprovalPanel
      state={baseState({ needsOverride: true })}
      viewer={{ id: "owner-1", hats: ["TECHNICAL_APPROVER"] }}
      onDecision={onDecision}
    />,
  );
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  await user.click(screen.getByRole("button", { name: /override & approve/i }));

  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain(
    "This decision will be recorded in the audit log as a single-approver override.",
  );
  const confirm = screen.getByRole("button", { name: /confirm/i });
  expect(confirm).toHaveProperty("disabled", true);

  await user.type(
    screen.getByLabelText(/justification/i),
    "I am the only technical approver available this release window",
  );
  expect(confirm).toHaveProperty("disabled", false);
  await user.click(confirm);

  expect(onDecision).toHaveBeenCalledWith({
    decision: "APPROVED",
    reason: "I am the only technical approver available this release window",
    overrideJustification:
      "I am the only technical approver available this release window",
  });
});

test("a decided step shows the decider name and reason; an override step shows the badge and justification", () => {
  render(
    <ApprovalPanel
      state={baseState({
        status: "APPROVED",
        currentStep: null,
        steps: [
          {
            id: "s1",
            order: 1,
            requiredHat: "TECHNICAL_APPROVER",
            status: "APPROVED",
            decision: {
              actorName: "Dana Dev",
              decision: "APPROVED",
              reason: "rollback plan checks out",
              isSingleApproverOverride: false,
              overrideJustification: null,
              decidedAt: now,
            },
          },
          {
            id: "s2",
            order: 2,
            requiredHat: "BUSINESS_APPROVER",
            status: "APPROVED",
            decision: {
              actorName: "Blair Biz",
              decision: "APPROVED",
              reason: "signed off",
              isSingleApproverOverride: true,
              overrideJustification: "Sole business approver this week",
              decidedAt: now,
            },
          },
        ],
      })}
      viewer={{ id: "v1", hats: [] }}
      onDecision={vi.fn()}
    />,
  );
  expect(screen.getByText("Dana Dev")).toBeTruthy();
  expect(screen.getByText("rollback plan checks out")).toBeTruthy();
  expect(screen.getByText("Blair Biz")).toBeTruthy();
  expect(screen.getByText(/single-approver override/i)).toBeTruthy();
  expect(screen.getByText("Sole business approver this week")).toBeTruthy();
});

test("status REJECTED renders the banner and no decision buttons even when currentStep is non-null", () => {
  render(
    <ApprovalPanel
      state={baseState({
        status: "REJECTED",
        // A hardening bug upstream could leak a non-null currentStep; the panel
        // must still gate on status.
        currentStep: { id: "s2", requiredHat: "TECHNICAL_APPROVER" },
      })}
      viewer={{ id: "tech-1", hats: ["TECHNICAL_APPROVER"] }}
      onDecision={vi.fn()}
    />,
  );
  expect(
    screen.getByText(
      "Approval was rejected — the change returned to assessing.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: /override & approve/i }),
  ).toBeNull();
});

test("status null renders the not-submitted message", () => {
  render(
    <ApprovalPanel
      state={baseState({ status: null, steps: [], currentStep: null })}
      viewer={{ id: "v1", hats: [] }}
      onDecision={vi.fn()}
    />,
  );
  expect(screen.getByText("Not yet submitted for approval.")).toBeTruthy();
});
