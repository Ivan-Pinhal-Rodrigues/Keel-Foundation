import type { $Enums, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/server/audit/write";
import { prisma } from "@/server/db/client";
import type { PrismaTransaction } from "@/server/db/tx";
import { emitNotification } from "@/server/modules/notify/emit";
import { currentStep } from "./state";

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
  client: PrismaClient = prisma,
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
