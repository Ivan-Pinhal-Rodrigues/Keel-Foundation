import type { $Enums } from "@prisma/client";
import { serializeApprovalState } from "@/server/modules/approval/serialize";
import type { ApprovalStateView } from "@/server/modules/approval/service";
import type { Actor } from "@/server/policy/actor";
import {
  CHANGE_STAGES,
  type ChangeStageKey,
  type GateInput,
  gateFor,
} from "./state";

/**
 * The change view (spec 03 §7). INTERNAL-ONLY: a change is never a guest
 * surface, so there is no allowlist and no guest branch — `getChangeForActor`
 * has already denied a guest before this runs.
 *
 * `serializeChange` assembles the drawer payload: the raw change columns, the
 * resolved lifecycle `stage`, the serialized approval panel, the linked
 * incidents, the originating demand ref, the activity timeline, and the
 * `stepper` (exactly the `LifecycleStepperProps` shape — per-stage exit gate,
 * plus `canAdvance` / `blockedReason` for the current stage).
 */

/** Plain lifecycle status label (spec 03 §7). */
export function changeStatusLabel(s: $Enums.ChangeStatus): string {
  switch (s) {
    case "DRAFT":
      return "Draft";
    case "ASSESSING":
      return "Assessing";
    case "APPROVAL":
      return "In approval";
    case "SCHEDULED":
      return "Scheduled";
    case "IMPLEMENTING":
      return "Implementing";
    case "PIR":
      return "Reviewing";
    case "CLOSED":
      return "Closed";
    case "ROLLED_BACK":
      return "Rolled back";
  }
}

/** One-line purpose shown under each stage in the stepper. */
const STAGE_PURPOSE: Record<ChangeStageKey, string> = {
  draft: "Capture the change and write its RFC.",
  assessing: "Assess risk and impact, and prepare the rollback plan.",
  approval: "Obtain the approvals the change policy requires.",
  scheduled: "Book a change window and keep the rollback plan in place.",
  implementing: "Carry out the change during its window.",
  pir: "Review the outcome and record the lessons learned.",
  closed: "The change is complete and closed.",
};

type ChangeRow = {
  id: string;
  ref: string;
  title: string;
  changeType: $Enums.ChangeType;
  rfc: string | null;
  riskLevel: $Enums.Level | null;
  impactAssessment: string | null;
  rollbackPlan: string | null;
  testPlan: string | null;
  status: $Enums.ChangeStatus;
  ownerId: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  originatingDemandId: string | null;
  implementedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  originatingDemand: { ref: string } | null;
  incidentLinks: {
    incidentId: string;
    kind: $Enums.LinkKind;
    incident: { ref: string };
  }[];
  pir: { valueRealized: $Enums.ValueRealized; lessons: string } | null;
};

export function serializeChange(
  row: ChangeRow,
  ctx: {
    approval: ApprovalStateView;
    actor: Actor;
    activity: { time: string; text: string }[];
  },
): Record<string, unknown> {
  const now = new Date();
  const rolledBack = row.status === "ROLLED_BACK";

  const gateInput: GateInput = {
    rfc: row.rfc,
    riskLevel: row.riskLevel,
    impactAssessment: row.impactAssessment,
    rollbackPlan: row.rollbackPlan,
    originatingDemandId: row.originatingDemandId,
    // The two free acknowledgements only matter at the `/advance` call — a
    // serialized read always shows them un-checked.
    standaloneConfirmed: false,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    changeType: row.changeType,
    valueRealized: row.pir?.valueRealized ?? null,
    lessons: row.pir?.lessons ?? null,
    wentToPlanAcknowledged: false,
  };

  const currentStage = CHANGE_STAGES.find((s) => s.status === row.status);
  const currentStageKey: ChangeStageKey = currentStage?.key ?? "draft";
  const currentGate = gateFor(
    currentStageKey,
    gateInput,
    ctx.approval.status,
    now,
  );

  const stages = CHANGE_STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    purpose: STAGE_PURPOSE[s.key],
    gate: gateFor(s.key, gateInput, ctx.approval.status, now).items,
    // A rolled-back change shows every stage reverted (CONTRACTS §10) — without
    // this its stepper reads as entirely un-started.
    ...(rolledBack ? { state: "reverted" as const } : {}),
  }));

  const stepper = {
    stages,
    currentStageKey,
    canAdvance: rolledBack ? false : currentGate.canAdvance,
    ...(!rolledBack && currentGate.blockedReason
      ? { blockedReason: currentGate.blockedReason }
      : {}),
  };

  return {
    id: row.id,
    ref: row.ref,
    title: row.title,
    changeType: row.changeType,
    rfc: row.rfc,
    riskLevel: row.riskLevel,
    impactAssessment: row.impactAssessment,
    rollbackPlan: row.rollbackPlan,
    testPlan: row.testPlan,
    status: row.status,
    statusLabel: changeStatusLabel(row.status),
    ownerId: row.ownerId,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    originatingDemandId: row.originatingDemandId,
    implementedAt: row.implementedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    stage: currentStage?.key ?? null,
    approval: serializeApprovalState(ctx.approval, ctx.actor),
    linkedIncidents: row.incidentLinks.map((l) => ({
      incidentId: l.incidentId,
      ref: l.incident.ref,
      kind: l.kind,
    })),
    originatingDemand: row.originatingDemand
      ? { ref: row.originatingDemand.ref }
      : null,
    activity: ctx.activity,
    stepper,
  };
}

/**
 * The list-card view — deliberately light: the change list does not fetch
 * per-row approval state, so no `stepper` / `approval` here.
 */
export function serializeChangeListItem(row: {
  id: string;
  ref: string;
  title: string;
  riskLevel: $Enums.Level | null;
  status: $Enums.ChangeStatus;
  ownerId: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  originatingDemand: { ref: string } | null;
}): Record<string, unknown> {
  return {
    id: row.id,
    ref: row.ref,
    title: row.title,
    riskLevel: row.riskLevel,
    status: row.status,
    statusLabel: changeStatusLabel(row.status),
    stage: CHANGE_STAGES.find((s) => s.status === row.status)?.key ?? null,
    originatingDemandRef: row.originatingDemand?.ref ?? null,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    ownerId: row.ownerId,
  };
}
