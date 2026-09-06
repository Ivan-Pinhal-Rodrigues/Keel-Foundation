import type { $Enums } from "@prisma/client";
import { ForbiddenError } from "@/server/policy/errors";

/**
 * The change lifecycle state machine and the exit-gate predicates (spec 03 §3).
 * Pure — no Prisma value import, no I/O. This file is imported by client
 * components (the change stepper, Tasks 12/13), so it must stay a leaf that
 * pulls in `@prisma/client` for types only.
 *
 * The status transitions are driven by `advanceChange` / `rollbackChange` in the
 * service; `APPROVAL → ASSESSING` is the approval-rejected edit path, and
 * `IMPLEMENTING → ROLLED_BACK` is the "did not go to plan" override (the drawer
 * calls `/rollback`, not `/advance`). `ROLLED_BACK` is terminal — it is not a
 * stage, so it is absent from `CHANGE_STAGES`.
 */

export type ChangeStageKey =
  | "draft"
  | "assessing"
  | "approval"
  | "scheduled"
  | "implementing"
  | "pir"
  | "closed";

/** The seven non-terminal stages, in lifecycle order, each mapped to its
 *  `ChangeStatus`. `ROLLED_BACK` is a terminal override, not a stage. */
export const CHANGE_STAGES: readonly {
  key: ChangeStageKey;
  label: string;
  status: $Enums.ChangeStatus;
}[] = [
  { key: "draft", label: "Draft", status: "DRAFT" },
  { key: "assessing", label: "Assess", status: "ASSESSING" },
  { key: "approval", label: "Approval", status: "APPROVAL" },
  { key: "scheduled", label: "Scheduled", status: "SCHEDULED" },
  { key: "implementing", label: "Implementing", status: "IMPLEMENTING" },
  { key: "pir", label: "PIR", status: "PIR" },
  { key: "closed", label: "Closed", status: "CLOSED" },
];

export const CHANGE_TRANSITIONS: Record<
  $Enums.ChangeStatus,
  readonly $Enums.ChangeStatus[]
> = {
  DRAFT: ["ASSESSING"],
  ASSESSING: ["APPROVAL"],
  APPROVAL: ["SCHEDULED", "ASSESSING"],
  SCHEDULED: ["IMPLEMENTING"],
  IMPLEMENTING: ["PIR", "ROLLED_BACK"],
  PIR: ["CLOSED"],
  CLOSED: [],
  ROLLED_BACK: [],
};

/** Throw `ForbiddenError` unless `from → to` is a declared transition. */
export function assertTransition(
  from: $Enums.ChangeStatus,
  to: $Enums.ChangeStatus,
): void {
  if (!CHANGE_TRANSITIONS[from].includes(to)) {
    throw new ForbiddenError(`illegal change transition: ${from} -> ${to}`);
  }
}

export type GateInput = {
  rfc: string | null;
  riskLevel: $Enums.Level | null;
  impactAssessment: string | null;
  rollbackPlan: string | null;
  originatingDemandId: string | null;
  standaloneConfirmed: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
  changeType: $Enums.ChangeType;
  valueRealized: $Enums.ValueRealized | null;
  lessons: string | null;
  wentToPlanAcknowledged: boolean;
};

export type GateResult = {
  items: { key: string; label: string; hint?: string; done: boolean }[];
  canAdvance: boolean;
  blockedReason?: string;
};

const filled = (s: string | null): boolean => s != null && s.trim().length > 0;

/**
 * The exit gate for `stage` — the checklist the actor sees and whether the
 * change may leave this stage. `canAdvance` is `items.every(done)` for the
 * field-backed stages, with the extra approval-status conditions folded in for
 * `approval` and `pir`.
 */
export function gateFor(
  stage: ChangeStageKey,
  input: GateInput,
  approvalStatus: $Enums.ApprovalStatus | null,
  now: Date,
): GateResult {
  switch (stage) {
    case "draft": {
      const items = [
        { key: "rfc", label: "RFC written", done: filled(input.rfc) },
        {
          key: "origin",
          label: "Linked to a demand, or confirmed as a standalone change",
          done: input.originatingDemandId != null || input.standaloneConfirmed,
        },
      ];
      return { items, canAdvance: items.every((i) => i.done) };
    }

    case "assessing": {
      const items = [
        {
          key: "riskLevel",
          label: "Risk level set",
          done: input.riskLevel != null,
        },
        {
          key: "impactAssessment",
          label: "Impact assessment written",
          done: filled(input.impactAssessment),
        },
        {
          key: "rollbackPlan",
          label: "Rollback plan written",
          done: filled(input.rollbackPlan),
        },
      ];
      return { items, canAdvance: items.every((i) => i.done) };
    }

    case "approval": {
      const emergency = input.changeType === "EMERGENCY";
      const done = approvalStatus === "APPROVED" || emergency;
      const items = [
        {
          key: "approved",
          label: emergency
            ? "Emergency change — proceeds ahead of approval"
            : "Approval granted",
          done,
        },
      ];
      if (done) return { items, canAdvance: true };
      let blockedReason: string;
      if (approvalStatus === "PENDING") {
        blockedReason = "Waiting on approval";
      } else if (approvalStatus === "REJECTED") {
        blockedReason = "Approval was rejected — edit and resubmit";
      } else {
        // null or CANCELLED
        blockedReason = "Submit for approval first";
      }
      return { items, canAdvance: false, blockedReason };
    }

    case "scheduled": {
      const windowOk =
        input.windowStart != null &&
        input.windowEnd != null &&
        input.windowStart.getTime() < input.windowEnd.getTime() &&
        input.windowStart.getTime() > now.getTime();
      const items = [
        {
          key: "window",
          label: "A future change window with a start before its end",
          done: windowOk,
        },
        {
          key: "rollbackPlan",
          label: "Rollback plan still in place",
          done: filled(input.rollbackPlan),
        },
      ];
      return { items, canAdvance: items.every((i) => i.done) };
    }

    case "implementing": {
      const items = [
        {
          key: "wentToPlanAcknowledged",
          label: "The change went to plan",
          hint: "If it did not, roll the change back instead of advancing.",
          done: input.wentToPlanAcknowledged,
        },
      ];
      return { items, canAdvance: input.wentToPlanAcknowledged };
    }

    case "pir": {
      const emergency = input.changeType === "EMERGENCY";
      const retroResolved =
        approvalStatus != null && approvalStatus !== "PENDING";
      const items = [
        {
          key: "valueRealized",
          label: "Value realized recorded",
          done: input.valueRealized != null,
        },
        {
          key: "lessons",
          label: "Lessons learned written",
          done: filled(input.lessons),
        },
      ];
      if (emergency) {
        items.push({
          key: "retrospectiveApproval",
          label: "Retrospective approval decision recorded",
          done: retroResolved,
        });
      }
      const canAdvance = items.every((i) => i.done);
      if (emergency && !retroResolved) {
        return {
          items,
          canAdvance,
          blockedReason: "Record the retrospective approval decision first",
        };
      }
      return { items, canAdvance };
    }

    case "closed":
      return { items: [], canAdvance: false };
  }
}
