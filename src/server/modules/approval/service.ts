import type { $Enums, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/server/audit/write";
import { prisma } from "@/server/db/client";
import type { PrismaTransaction } from "@/server/db/tx";
import { emitNotification } from "@/server/modules/notify/emit";
import type { Actor } from "@/server/policy/actor";
import {
  ConflictError,
  ForbiddenError,
  SegregationError,
} from "@/server/policy/errors";
import { currentStep, overrideActionFor, resolveRequestStatus } from "./state";

/**
 * The approval engine's open / read / cancel use cases (spec 04 §3, §7).
 *
 * `openApprovalRequest` and `cancelRequest` take the caller's `tx` so the
 * `ApprovalRequest` / `ApprovalStep` rows, their `AuditEvent`, and any
 * `APPROVAL_NEEDED` notification commit or roll back together. `getApprovalState`
 * is a pure read — it audits nothing and opens its own client.
 */

export type OpenApprovalInput = {
  subjectType: string; // "change" in v1
  subjectId: string;
  createdById: string; // the change owner — drives the SoD check
  policyKey: string; // "change.standard" | "change.high_risk"
  steps: { order: number; requiredHat: $Enums.Hat }[];
};

/**
 * Open a fresh approval request with its ordered steps, all PENDING. A re-submit
 * opens a new request; the previous one stays in the log (spec 04 §3).
 *
 * The first step's hat holders are notified, minus the creator. If the only
 * holder of that hat IS the creator, `emitNotification` writes zero rows — that
 * is correct: the UI surfaces the single-approver override path (spec 04 §7).
 */
export async function openApprovalRequest(
  tx: PrismaTransaction,
  input: OpenApprovalInput,
): Promise<{ id: string }> {
  const request = await tx.approvalRequest.create({
    data: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      policyKey: input.policyKey,
      createdById: input.createdById,
      status: "PENDING",
      steps: {
        create: input.steps.map((s) => ({
          order: s.order,
          requiredHat: s.requiredHat,
          status: "PENDING",
        })),
      },
    },
  });

  await writeAudit(tx, {
    actorId: input.createdById,
    action: "approval.request_opened",
    subjectType: "ApprovalRequest",
    subjectId: request.id,
    payload: {
      policyKey: input.policyKey,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      stepHats: input.steps.map((s) => s.requiredHat),
    },
  });

  await emitNotification(tx, {
    recipients: { hat: input.steps[0]!.requiredHat },
    kind: "APPROVAL_NEEDED",
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    summary: `Approval needed on ${input.subjectType} ${input.subjectId}`,
    excludeActorId: input.createdById,
  });

  return { id: request.id };
}

export type ApprovalStateView = {
  requestId: string | null;
  status: $Enums.ApprovalStatus | null; // null when no request has ever been opened
  policyKey: string | null;
  createdById: string | null;
  steps: {
    id: string;
    order: number;
    requiredHat: $Enums.Hat;
    status: $Enums.StepStatus;
    decision: {
      actorId: string;
      actorName: string;
      decision: $Enums.DecisionKind;
      reason: string;
      isSingleApproverOverride: boolean;
      overrideJustification: string | null;
      decidedAt: string;
    } | null;
  }[];
  currentStep: { id: string; requiredHat: $Enums.Hat } | null;
};

/**
 * The most recent request for the subject and its per-step decisions, or an
 * all-null view when none exists (spec 04 §3 — a re-submit opens a fresh one,
 * the old stays in the log).
 */
export async function getApprovalState(
  subjectType: string,
  subjectId: string,
  client: PrismaClient | PrismaTransaction = prisma,
): Promise<ApprovalStateView> {
  const request = await client.approvalRequest.findFirst({
    where: { subjectType, subjectId },
    orderBy: { createdAt: "desc" },
    include: {
      steps: {
        orderBy: { order: "asc" },
        include: {
          decisions: {
            orderBy: { decidedAt: "asc" },
            include: { actor: { select: { displayName: true } } },
          },
        },
      },
    },
  });

  if (!request) {
    return {
      requestId: null,
      status: null,
      policyKey: null,
      createdById: null,
      steps: [],
      currentStep: null,
    };
  }

  const steps = request.steps.map((step) => {
    // At most one decision per step in v1; take the last defensively.
    const last = step.decisions[step.decisions.length - 1];
    return {
      id: step.id,
      order: step.order,
      requiredHat: step.requiredHat,
      status: step.status,
      decision: last
        ? {
            actorId: last.actorId,
            actorName: last.actor.displayName,
            decision: last.decision,
            reason: last.reason,
            isSingleApproverOverride: last.isSingleApproverOverride,
            overrideJustification: last.overrideJustification,
            decidedAt: last.decidedAt.toISOString(),
          }
        : null,
    };
  });

  const cur = currentStep(steps);

  return {
    requestId: request.id,
    status: request.status,
    policyKey: request.policyKey,
    createdById: request.createdById,
    steps,
    currentStep: cur ? { id: cur.id, requiredHat: cur.requiredHat } : null,
  };
}

/**
 * Cancel the latest PENDING request for the subject: request CANCELLED, every
 * PENDING step SKIPPED, `resolvedAt` stamped, `approval.request_cancelled`
 * audited. A no-op (not an error) when there is no PENDING request.
 */
export async function cancelRequest(
  tx: PrismaTransaction,
  input: {
    subjectType: string;
    subjectId: string;
    reason: string;
    actorId: string;
  },
): Promise<void> {
  const request = await tx.approvalRequest.findFirst({
    where: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: "PENDING",
    },
    orderBy: { createdAt: "desc" },
  });
  if (!request) return;

  const now = new Date();
  await tx.approvalStep.updateMany({
    where: { requestId: request.id, status: "PENDING" },
    data: { status: "SKIPPED", resolvedAt: now },
  });
  await tx.approvalRequest.update({
    where: { id: request.id },
    data: { status: "CANCELLED", resolvedAt: now },
  });

  await writeAudit(tx, {
    actorId: input.actorId,
    action: "approval.request_cancelled",
    subjectType: "ApprovalRequest",
    subjectId: request.id,
    payload: { reason: input.reason },
  });
}

/**
 * Every PENDING approval request whose CURRENT step's `requiredHat` the actor
 * holds — the data behind `GET /api/approvals` (spec 04 §7). `needsOverride` is
 * true when the actor is the request's creator (a decision would need the
 * single-approver justification). For a `change` subject the `Change` row is
 * joined for its ref / title. A rejected or resolved request never appears.
 */
export async function listApprovalsForActor(
  actor: Actor,
  client: PrismaClient = prisma,
): Promise<
  {
    subjectType: string;
    subjectId: string;
    subjectRef: string;
    subjectTitle: string;
    policyKey: string;
    currentRequiredHat: $Enums.Hat;
    needsOverride: boolean;
  }[]
> {
  const requests = await client.approvalRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: { steps: { orderBy: { order: "asc" } } },
  });

  const out: {
    subjectType: string;
    subjectId: string;
    subjectRef: string;
    subjectTitle: string;
    policyKey: string;
    currentRequiredHat: $Enums.Hat;
    needsOverride: boolean;
  }[] = [];

  for (const request of requests) {
    const step = currentStep(request.steps);
    if (!step || !actor.hats.includes(step.requiredHat)) continue;

    let subjectRef = "";
    let subjectTitle = "";
    if (request.subjectType === "change") {
      const change = await client.change.findUnique({
        where: { id: request.subjectId },
        select: { ref: true, title: true },
      });
      if (!change) continue;
      subjectRef = change.ref;
      subjectTitle = change.title;
    }

    out.push({
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      subjectRef,
      subjectTitle,
      policyKey: request.policyKey,
      currentRequiredHat: step.requiredHat,
      needsOverride: actor.id === request.createdById,
    });
  }

  return out;
}

export type RecordDecisionInput = {
  stepId: string;
  actor: Actor;
  decision: $Enums.DecisionKind; // "APPROVED" | "REJECTED"
  /** Required, non-empty; the route schema enforces min 1, the service re-trims. */
  reason: string;
  /** Required (min 20 trimmed chars) only when SoD would otherwise block. */
  overrideJustification?: string;
};

/**
 * Record the decision on an approval request's current step — the engine's only
 * decision mutation (spec 04 §4, §5). Runs on the caller's `tx` so the
 * `ApprovalDecision`, the step / request updates, their `AuditEvent`s, and any
 * notification commit or roll back together.
 *
 * `ApprovalDecision` is a record-of-fact table (INSERT + SELECT only for the
 * runtime role), so this only ever `tx.approvalDecision.create(...)`s a row —
 * never `.update` / `.upsert`. A decided step is resolved and can never come up
 * for decision again, so there is no real update path.
 *
 * Enforcement order (spec 04 §5):
 *   1. the step exists and is the current pending step of a pending request —
 *      else `ConflictError`;
 *   2. the actor holds the step's `requiredHat` — else `ForbiddenError`;
 *   3. SoD — the creator deciding their own request needs a >= 20-char
 *      `overrideJustification`, else `SegregationError(overrideActionFor(hat))`;
 *      with one, the decision is flagged `isSingleApproverOverride` and a second
 *      `approval.override` audit event is written.
 *
 * Returns the request's status after this decision: `"PENDING"` while steps
 * remain, otherwise the resolved value.
 */
export async function recordDecision(
  tx: PrismaTransaction,
  input: RecordDecisionInput,
): Promise<{ requestStatus: $Enums.ApprovalStatus }> {
  const step = await tx.approvalStep.findUnique({
    where: { id: input.stepId },
    include: { request: { include: { steps: true } } },
  });
  if (!step) throw new ConflictError("the approval step does not exist");

  const request = step.request;
  if (request.status !== "PENDING") {
    throw new ConflictError("the approval request is no longer pending");
  }
  if (currentStep(request.steps)?.id !== step.id) {
    throw new ConflictError("this step is not awaiting a decision");
  }

  if (!input.actor.hats.includes(step.requiredHat)) {
    throw new ForbiddenError(
      "the actor does not hold this step's required hat",
    );
  }

  const isCreator = input.actor.id === request.createdById;
  const override =
    typeof input.overrideJustification === "string" &&
    input.overrideJustification.trim().length >= 20;
  const singleApproverOverride = isCreator && override;
  if (isCreator && !override) {
    throw new SegregationError(overrideActionFor(step.requiredHat));
  }

  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new ConflictError("a decision requires a reason");
  }
  const justification = singleApproverOverride
    ? input.overrideJustification!.trim()
    : null;

  const now = new Date();
  const nextStepStatus: $Enums.StepStatus =
    input.decision === "APPROVED" ? "APPROVED" : "REJECTED";

  // Resolve the step — and, if this decision finishes it, the request — with
  // CONDITIONAL writes, BEFORE the immutable `ApprovalDecision` row. Under READ
  // COMMITTED a second concurrent decision on the same step blocks on this row's
  // lock, then re-checks its `status: "PENDING"` WHERE against the committed row,
  // matches nothing, and this `count === 0` branch throws — so exactly one
  // decision is ever recorded per step. (The `findUnique` guards above are the
  // fast path; this is the race backstop.)
  const stepUpdate = await tx.approvalStep.updateMany({
    where: { id: step.id, status: "PENDING" },
    data: { status: nextStepStatus, resolvedAt: now },
  });
  if (stepUpdate.count === 0) {
    throw new ConflictError("this step is not awaiting a decision");
  }

  // Recompute the request status from the now-committed sibling statuses.
  const siblings = await tx.approvalStep.findMany({
    where: { requestId: request.id },
    orderBy: { order: "asc" },
  });
  const requestStatus = resolveRequestStatus(siblings);
  if (requestStatus !== "PENDING") {
    await tx.approvalRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: requestStatus, resolvedAt: now },
    });
  }

  await tx.approvalDecision.create({
    data: {
      stepId: step.id,
      actorId: input.actor.id,
      decision: input.decision,
      reason,
      isSingleApproverOverride: singleApproverOverride,
      overrideJustification: justification,
    },
  });

  // Audit — all on the consumer's `requestId`, subject "ApprovalRequest".
  await writeAudit(tx, {
    actorId: input.actor.id,
    action:
      input.decision === "APPROVED"
        ? "approval.step_approved"
        : "approval.step_rejected",
    subjectType: "ApprovalRequest",
    subjectId: request.id,
    payload: { stepOrder: step.order, reason },
  });
  if (singleApproverOverride) {
    await writeAudit(tx, {
      actorId: input.actor.id,
      action: "approval.override",
      subjectType: "ApprovalRequest",
      subjectId: request.id,
      payload: {
        stepOrder: step.order,
        justification,
        createdById: request.createdById,
        actorId: input.actor.id,
      },
    });
  }
  if (requestStatus !== "PENDING") {
    await writeAudit(tx, {
      actorId: input.actor.id,
      action: "approval.request_resolved",
      subjectType: "ApprovalRequest",
      subjectId: request.id,
      payload: { status: requestStatus },
    });
  }

  // Notify. Keyed on the change (`request.subjectType` / `request.subjectId`),
  // matching `openApprovalRequest`, so a subject-keyed feed and the notification
  // deep-links stay consistent. (The `approval.*` audit events above stay on
  // `subjectType: "ApprovalRequest"` — spec 04 §6 event chain.)
  const nextStep = currentStep(siblings);
  if (input.decision === "APPROVED" && nextStep) {
    await emitNotification(tx, {
      recipients: { hat: nextStep.requiredHat },
      kind: "APPROVAL_NEEDED",
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      summary: `Approval needed on ${request.subjectType} ${request.subjectId}`,
      excludeActorId: request.createdById,
    });
  }
  if (requestStatus !== "PENDING") {
    await emitNotification(tx, {
      recipients: { userIds: [request.createdById] },
      kind: "STATUS_CHANGED",
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      summary: `Approval ${requestStatus.toLowerCase()} on ${request.subjectType} ${request.subjectId}`,
    });
  }
  if (singleApproverOverride) {
    await emitNotification(tx, {
      recipients: { audience: "ALL_INTERNAL" },
      kind: "STATUS_CHANGED",
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      summary: "A change approval used a single-approver override",
      excludeActorId: input.actor.id,
    });
  }

  return { requestStatus };
}
