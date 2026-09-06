import type { $Enums, Prisma, PrismaClient } from "@prisma/client";
import { auditActionLabel } from "@/server/audit/labels";
import { writeAudit } from "@/server/audit/write";
import { prisma } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import type { PrismaTransaction } from "@/server/db/tx";
import { nextRef } from "@/server/ids/ref";
import {
  cancelRequest,
  getApprovalState,
  openApprovalRequest,
} from "@/server/modules/approval/service";
import { emitNotification } from "@/server/modules/notify/emit";
import type { Actor } from "@/server/policy/actor";
import { authorize } from "@/server/policy/authorize";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/server/policy/errors";
import { requireInternal } from "@/server/policy/subjects/helpers";
import {
  changeStatusLabel,
  serializeChange,
  serializeChangeListItem,
} from "./serialize";
import {
  CHANGE_STAGES,
  type GateInput,
  assertTransition,
  gateFor,
} from "./state";

/**
 * The change use cases: create, from-demand conversion, list, and get
 * (`plans/plan-03-change-approvals` Task 5). Every write takes the caller's
 * `tx` so the change row and its `AuditEvent` commit or roll back together;
 * reads open their own client. Gate before the load — a guest gets a 403 on
 * `/api/changes/**` with no existence oracle (plan ruling P3).
 */

const DETAIL_INCLUDE = {
  originatingDemand: { select: { ref: true } },
  incidentLinks: { include: { incident: { select: { ref: true } } } },
  pir: true,
} as const;

const LIST_INCLUDE = {
  originatingDemand: { select: { ref: true } },
  owner: { select: { displayName: true } },
} as const;

export type CreateChangeInput = {
  title: string;
  rfc: string;
  changeType?: $Enums.ChangeType;
  originatingDemandId?: string;
};

export async function createChange(
  actor: Actor,
  tx: PrismaTransaction,
  input: CreateChangeInput,
): Promise<{ id: string; ref: string }> {
  authorize(actor, "change.create", { type: "change" });

  const ref = await nextRef(tx, "CHG");
  const change = await tx.change.create({
    data: {
      ref,
      title: input.title,
      rfc: input.rfc,
      changeType: input.changeType ?? "NORMAL",
      status: "DRAFT",
      ownerId: actor.id,
      originatingDemandId: input.originatingDemandId ?? null,
    },
  });

  await writeAudit(tx, {
    actorId: actor.id,
    action: "change.created",
    subjectType: "Change",
    subjectId: change.id,
    payload: { originatingDemandId: input.originatingDemandId ?? null },
  });

  return { id: change.id, ref: change.ref };
}

/**
 * Idempotent on `Change.originatingDemandId @unique`. Returns the existing
 * change (no second audit event) when one already exists for the demand. Does
 * NOT move the demand — the demand service's `convertDemand` does that after
 * this returns.
 *
 * A pre-check keeps the idempotent path on a clean transaction: a caught P2002
 * would abort the surrounding interactive transaction (Postgres 25P02) and
 * strand the follow-up read. The `try/catch` stays as a backstop for a genuine
 * concurrent race.
 */
export async function createChangeFromDemand(
  tx: PrismaTransaction,
  input: { demandId: string; actor: Actor },
): Promise<{ id: string; ref: string; created: boolean }> {
  const { demandId, actor } = input;

  const demand = await tx.demand.findUnique({
    where: { id: demandId },
    select: { title: true, status: true },
  });
  if (!demand) throw new NotFoundError("not found");

  const prior = await tx.change.findFirst({
    where: { originatingDemandId: demandId },
    select: { id: true, ref: true },
  });
  if (prior) return { id: prior.id, ref: prior.ref, created: false };

  try {
    const ref = await nextRef(tx, "CHG");
    const change = await tx.change.create({
      data: {
        ref,
        title: demand.title,
        rfc: "",
        changeType: "NORMAL",
        status: "DRAFT",
        ownerId: actor.id,
        originatingDemandId: demandId,
      },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: "change.created",
      subjectType: "Change",
      subjectId: change.id,
      payload: { originatingDemandId: demandId, fromDemand: true },
    });

    return { id: change.id, ref: change.ref, created: true };
  } catch (e) {
    if (isUniqueViolation(e, "originatingDemandId")) {
      const existing = await tx.change.findFirstOrThrow({
        where: { originatingDemandId: demandId },
      });
      return { id: existing.id, ref: existing.ref, created: false };
    }
    throw e;
  }
}

/**
 * The change edit + incident-link writes (`plans/plan-03-change-approvals`
 * Task 6). Each takes the caller's `tx` so the change row and its `AuditEvent`s
 * commit or roll back together. The `change.edit` rule allows the owner OR a
 * DEVELOPER, so the owner id is loaded first and passed on the subject — the
 * load precedes the gate here for that reason.
 */

const EDIT_LOCKED_STATUSES: $Enums.ChangeStatus[] = [
  "IMPLEMENTING",
  "PIR",
  "CLOSED",
  "ROLLED_BACK",
];

export type EditChangeInput = {
  rfc?: string;
  riskLevel?: $Enums.Level;
  impactAssessment?: string;
  rollbackPlan?: string;
};

/**
 * Edit the RFC / risk / impact / rollback fields of a change. Only the provided
 * keys are written. Rejected once the change is `IMPLEMENTING` or later — the
 * record is frozen for implementation. Beyond the always-written `change.edited`
 * event, setting `riskLevel` also writes `change.risk_assessed` and setting a
 * non-empty `rollbackPlan` also writes `change.rollback_plan_set`.
 */
export async function editChange(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: EditChangeInput,
): Promise<void> {
  const row = await tx.change.findUnique({
    where: { id },
    select: { ownerId: true, status: true },
  });
  authorize(actor, "change.edit", {
    type: "change",
    id,
    ownerId: row?.ownerId,
  });
  if (!row) throw new NotFoundError("not found");

  if (EDIT_LOCKED_STATUSES.includes(row.status)) {
    throw new ForbiddenError("the change is locked for editing");
  }

  const data: Prisma.ChangeUpdateInput = {};
  if (input.rfc !== undefined) data.rfc = input.rfc;
  if (input.riskLevel !== undefined) data.riskLevel = input.riskLevel;
  if (input.impactAssessment !== undefined) {
    data.impactAssessment = input.impactAssessment;
  }
  if (input.rollbackPlan !== undefined) data.rollbackPlan = input.rollbackPlan;

  await tx.change.update({ where: { id }, data });

  await writeAudit(tx, {
    actorId: actor.id,
    action: "change.edited",
    subjectType: "Change",
    subjectId: id,
    payload: { fields: Object.keys(input) },
  });

  if (input.riskLevel !== undefined) {
    await writeAudit(tx, {
      actorId: actor.id,
      action: "change.risk_assessed",
      subjectType: "Change",
      subjectId: id,
      payload: { riskLevel: input.riskLevel },
    });
  }

  if (input.rollbackPlan !== undefined && input.rollbackPlan.trim() !== "") {
    await writeAudit(tx, {
      actorId: actor.id,
      action: "change.rollback_plan_set",
      subjectType: "Change",
      subjectId: id,
      payload: {},
    });
  }
}

/**
 * Link an incident to a change with a `CAUSED_BY` / `FIXES` kind. Idempotent on
 * `ChangeIncidentLink @@unique([changeId, incidentId, kind])` — a repeat of an
 * existing link is a no-op with no second audit event.
 *
 * The pre-check keeps the idempotent path on a clean transaction: a caught P2002
 * would abort the surrounding interactive transaction (Postgres 25P02). The
 * `try/catch` stays as a backstop for a genuine concurrent race (same shape as
 * `createChangeFromDemand`).
 */
export async function linkIncident(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: { incidentId: string; kind: $Enums.LinkKind },
): Promise<void> {
  const row = await tx.change.findUnique({
    where: { id },
    select: { ownerId: true },
  });
  authorize(actor, "change.edit", {
    type: "change",
    id,
    ownerId: row?.ownerId,
  });
  if (!row) throw new NotFoundError("not found");

  const incident = await tx.incident.findUnique({
    where: { id: input.incidentId },
    select: { id: true },
  });
  if (!incident) throw new NotFoundError("incident not found");

  const existing = await tx.changeIncidentLink.findFirst({
    where: { changeId: id, incidentId: input.incidentId, kind: input.kind },
    select: { id: true },
  });
  if (existing) return;

  try {
    await tx.changeIncidentLink.create({
      data: { changeId: id, incidentId: input.incidentId, kind: input.kind },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: "change.incident_linked",
      subjectType: "Change",
      subjectId: id,
      payload: { incidentId: input.incidentId, kind: input.kind },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return;
    throw e;
  }
}

export async function listChanges(
  actor: Actor,
  filters: {
    status?: $Enums.ChangeStatus;
    mine?: boolean;
    scheduled?: boolean;
  },
  client: PrismaClient = prisma,
): Promise<Record<string, unknown>[]> {
  // A change register has no client scope — a guest gets a flat 403 here, before
  // any row is read (plan ruling P3).
  requireInternal(actor);

  const rows = await client.change.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.mine ? { ownerId: actor.id } : {}),
      ...(filters.scheduled ? { status: "SCHEDULED" } : {}),
    },
    include: LIST_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(serializeChangeListItem);
}

/** A short, stable timestamp string for a timeline row ("2026-09-06 14:30"). */
function formatActivityTime(at: Date): string {
  return at.toISOString().slice(0, 16).replace("T", " ");
}

export async function getChangeForActor(
  actor: Actor,
  id: string,
  client: PrismaClient = prisma,
): Promise<Record<string, unknown>> {
  // 403 for a guest before the load — no existence oracle (plan ruling P3).
  requireInternal(actor);

  const row = await client.change.findUnique({
    where: { id },
    include: DETAIL_INCLUDE,
  });
  if (!row) throw new NotFoundError("not found");
  authorize(actor, "change.view", { type: "change", id });

  const approval = await getApprovalState("change", id, client);

  const changeEvents = await client.auditEvent.findMany({
    where: { subjectType: "Change", subjectId: id },
    orderBy: { at: "asc" },
    select: { action: true, at: true },
  });
  const approvalEvents = approval.requestId
    ? await client.auditEvent.findMany({
        where: {
          subjectType: "ApprovalRequest",
          subjectId: approval.requestId,
        },
        orderBy: { at: "asc" },
        select: { action: true, at: true },
      })
    : [];

  const activity = [...changeEvents, ...approvalEvents]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((e) => ({
      time: formatActivityTime(e.at),
      text: auditActionLabel(e.action),
    }));

  return serializeChange(row, { approval, actor, activity });
}

/**
 * The lifecycle transitions (`plans/plan-03-change-approvals` Task 7):
 * `advanceChange` (the general forward stage-advance, gated by `gateFor`),
 * `scheduleChange` (set/adjust the change window, with the `APPROVAL → SCHEDULED`
 * enter folded in), `rollbackChange` (`IMPLEMENTING → ROLLED_BACK`), and
 * `recordPir` (write the record-of-fact post-implementation review). Each takes
 * the caller's `tx` so the change row, its `AuditEvent`s, and any notification
 * commit or roll back together. The `change.transition` / `change.schedule` /
 * `change.pir` gate runs before the load, uniformly with the rest of the module.
 */

/** The one forward status out of each non-terminal stage (spec 03 §3). The
 *  backward `APPROVAL → ASSESSING` (rejection) and `IMPLEMENTING → ROLLED_BACK`
 *  edges are driven elsewhere. */
const CHANGE_FORWARD: Partial<
  Record<$Enums.ChangeStatus, $Enums.ChangeStatus>
> = {
  DRAFT: "ASSESSING",
  ASSESSING: "APPROVAL",
  APPROVAL: "SCHEDULED",
  SCHEDULED: "IMPLEMENTING",
  IMPLEMENTING: "PIR",
  PIR: "CLOSED",
};

type GateSourceRow = {
  rfc: string | null;
  riskLevel: $Enums.Level | null;
  impactAssessment: string | null;
  rollbackPlan: string | null;
  originatingDemandId: string | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  changeType: $Enums.ChangeType;
  pir: { valueRealized: $Enums.ValueRealized; lessons: string } | null;
};

/** Build the synthetic `GateInput` the stage gates read — the change columns
 *  plus the two free-checkbox acknowledgements the actor sends on `/advance`. */
function gateInputFor(
  row: GateSourceRow,
  acknowledgements: Record<string, boolean> | undefined,
): GateInput {
  const acks = acknowledgements ?? {};
  return {
    rfc: row.rfc,
    riskLevel: row.riskLevel,
    impactAssessment: row.impactAssessment,
    rollbackPlan: row.rollbackPlan,
    originatingDemandId: row.originatingDemandId,
    standaloneConfirmed: acks.standaloneConfirmed ?? false,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    changeType: row.changeType,
    valueRealized: row.pir?.valueRealized ?? null,
    lessons: row.pir?.lessons ?? null,
    wentToPlanAcknowledged: acks.wentToPlanAcknowledged ?? false,
  };
}

export async function advanceChange(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: {
    from: $Enums.ChangeStatus;
    acknowledgements?: Record<string, boolean>;
  },
): Promise<void> {
  authorize(actor, "change.transition", { type: "change", id });

  const row = await tx.change.findUnique({
    where: { id },
    include: { pir: true },
  });
  if (!row) throw new NotFoundError("not found");
  if (input.from !== row.status) {
    throw new ConflictError("the change moved since you loaded it");
  }

  const approval = await getApprovalState("change", id, tx);
  const stage = CHANGE_STAGES.find((s) => s.status === row.status);
  if (!stage) throw new ForbiddenError("the change is in a terminal state");

  const gate = gateFor(
    stage.key,
    gateInputFor(row, input.acknowledgements),
    approval.status,
    new Date(),
  );
  if (!gate.canAdvance) {
    throw new ForbiddenError(
      gate.blockedReason ?? "the exit gate is not satisfied",
    );
  }

  const to = CHANGE_FORWARD[row.status];
  if (!to) throw new ForbiddenError("the change is in a terminal state");
  assertTransition(row.status, to);

  const now = new Date();
  await tx.change.update({
    where: { id },
    data: {
      status: to,
      ...(to === "IMPLEMENTING" ? { implementedAt: now } : {}),
      ...(to === "CLOSED" ? { closedAt: now } : {}),
    },
  });

  await writeAudit(tx, {
    actorId: actor.id,
    action: "change.advanced",
    subjectType: "Change",
    subjectId: id,
    payload: {
      from: row.status,
      to,
      acknowledgements: input.acknowledgements ?? {},
    },
  });
  if (to === "IMPLEMENTING") {
    await writeAudit(tx, {
      actorId: actor.id,
      action: "change.implementing",
      subjectType: "Change",
      subjectId: id,
      payload: {},
    });
  }
  if (to === "CLOSED") {
    await writeAudit(tx, {
      actorId: actor.id,
      action: "change.closed",
      subjectType: "Change",
      subjectId: id,
      payload: {},
    });
  }

  if (to === "SCHEDULED" || to === "IMPLEMENTING" || to === "PIR") {
    await emitNotification(tx, {
      recipients: { audience: "ALL_INTERNAL" },
      kind: "STATUS_CHANGED",
      subjectType: "change",
      subjectId: id,
      summary: `${row.ref} moved to ${changeStatusLabel(to)}`,
      excludeActorId: actor.id,
    });
  }

  if (to === "CLOSED") {
    if (row.originatingDemandId) {
      const demand = await tx.demand.findUnique({
        where: { id: row.originatingDemandId },
        select: { submittedById: true },
      });
      if (demand) {
        await emitNotification(tx, {
          recipients: { userIds: [demand.submittedById] },
          kind: "STATUS_CHANGED",
          subjectType: "demand",
          subjectId: row.originatingDemandId,
          summary: "Your request has been delivered",
        });
      }
    }
    const fixes = await tx.changeIncidentLink.findMany({
      where: { changeId: id, kind: "FIXES" },
      include: { incident: { select: { id: true, reportedById: true } } },
    });
    for (const link of fixes) {
      await emitNotification(tx, {
        recipients: { userIds: [link.incident.reportedById] },
        kind: "STATUS_CHANGED",
        subjectType: "incident",
        subjectId: link.incident.id,
        summary: "An issue affecting you has been fixed",
      });
    }
  }
}

export async function scheduleChange(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: { windowStart: Date; windowEnd: Date },
): Promise<void> {
  authorize(actor, "change.schedule", { type: "change", id });

  const row = await tx.change.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("not found");
  if (row.status !== "APPROVAL" && row.status !== "SCHEDULED") {
    throw new ForbiddenError("the change is not ready to be scheduled");
  }

  const { windowStart, windowEnd } = input;
  if (!(
    windowStart.getTime() < windowEnd.getTime() &&
    windowStart.getTime() > Date.now()
  )) {
    throw new ForbiddenError(
      "the window must be a future range with start before end",
    );
  }

  await tx.change.update({ where: { id }, data: { windowStart, windowEnd } });
  await writeAudit(tx, {
    actorId: actor.id,
    action: "change.scheduled",
    subjectType: "Change",
    subjectId: id,
    payload: { windowStart, windowEnd },
  });

  if (row.status === "APPROVAL") {
    const approval = await getApprovalState("change", id, tx);
    if (approval.status === "APPROVED" || row.changeType === "EMERGENCY") {
      assertTransition("APPROVAL", "SCHEDULED");
      await tx.change.update({
        where: { id },
        data: { status: "SCHEDULED" },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "change.advanced",
        subjectType: "Change",
        subjectId: id,
        payload: { from: "APPROVAL", to: "SCHEDULED" },
      });
      // Spec 03 §7 "scheduled → the other internal user". A NORMAL approved
      // change enters SCHEDULED through this folded transition (plan ruling
      // P4), never through `advanceChange` — so the "scheduled" notification
      // has to fire here too. The two paths are mutually exclusive: a change
      // enters SCHEDULED exactly once, so exactly one notification is emitted.
      await emitNotification(tx, {
        recipients: { audience: "ALL_INTERNAL" },
        kind: "STATUS_CHANGED",
        subjectType: "change",
        subjectId: id,
        summary: `${row.ref} moved to ${changeStatusLabel("SCHEDULED")}`,
        excludeActorId: actor.id,
      });
    } else {
      throw new ForbiddenError(
        "the change must be approved before it can be scheduled",
      );
    }
  }
}

export async function rollbackChange(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: { note: string },
): Promise<void> {
  authorize(actor, "change.transition", { type: "change", id });

  const row = await tx.change.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("not found");
  if (row.status !== "IMPLEMENTING") {
    throw new ForbiddenError(
      "only a change that is being implemented can be rolled back",
    );
  }

  assertTransition("IMPLEMENTING", "ROLLED_BACK");
  await tx.change.update({
    where: { id },
    data: { status: "ROLLED_BACK", closedAt: new Date() },
  });
  await writeAudit(tx, {
    actorId: actor.id,
    action: "change.rolled_back",
    subjectType: "Change",
    subjectId: id,
    payload: { note: input.note.trim() },
  });
  await emitNotification(tx, {
    recipients: { audience: "ALL_INTERNAL" },
    kind: "STATUS_CHANGED",
    subjectType: "change",
    subjectId: id,
    summary: `${row.ref} was rolled back`,
    excludeActorId: actor.id,
  });
}

export async function recordPir(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: { valueRealized: $Enums.ValueRealized; lessons: string },
): Promise<void> {
  authorize(actor, "change.pir", { type: "change", id });

  const row = await tx.change.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("not found");
  if (row.status !== "PIR") {
    throw new ForbiddenError("the change is not in review");
  }

  // `PostImplementationReview` is a record-of-fact table (INSERT + SELECT only
  // for `keel_app`): only ever `.create` here, never `.update` / `.upsert`. The
  // pre-check keeps the transaction clean — a caught P2002 would abort it
  // (Postgres 25P02); the `try/catch` stays as a backstop for a genuine race.
  const existing = await tx.postImplementationReview.findFirst({
    where: { changeId: id },
    select: { id: true },
  });
  if (existing) throw new ConflictError("a PIR is already recorded");

  try {
    await tx.postImplementationReview.create({
      data: {
        changeId: id,
        valueRealized: input.valueRealized,
        lessons: input.lessons.trim(),
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
    });
  } catch (e) {
    if (isUniqueViolation(e, "changeId")) {
      throw new ConflictError("a PIR is already recorded");
    }
    throw e;
  }

  await writeAudit(tx, {
    actorId: actor.id,
    action: "change.pir_recorded",
    subjectType: "Change",
    subjectId: id,
    payload: { valueRealized: input.valueRealized },
  });
  await emitNotification(tx, {
    recipients: { audience: "ALL_INTERNAL" },
    kind: "STATUS_CHANGED",
    subjectType: "change",
    subjectId: id,
    summary: `${row.ref} post-implementation review recorded`,
    excludeActorId: actor.id,
  });
}

/**
 * Submit-for-approval + the narrow read the approve route needs
 * (`plans/plan-03-change-approvals` Task 8).
 *
 * `submitForApproval` opens the approval request (one TECHNICAL_APPROVER step
 * for a standard change, TECHNICAL then BUSINESS for a HIGH-risk one) and moves
 * the change `ASSESSING → APPROVAL`. It runs on the caller's `tx` so the request
 * rows, the change update, and every `AuditEvent` commit or roll back together.
 * The `change.submit_for_approval` rule is owner-only, so the owner id is loaded
 * before the gate.
 */
export async function submitForApproval(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
): Promise<void> {
  const row = await tx.change.findUnique({
    where: { id },
    select: {
      ownerId: true,
      status: true,
      riskLevel: true,
      rollbackPlan: true,
      impactAssessment: true,
    },
  });
  authorize(actor, "change.submit_for_approval", {
    type: "change",
    id,
    ownerId: row?.ownerId,
  });
  if (!row) throw new NotFoundError("not found");

  if (row.status !== "ASSESSING") {
    throw new ForbiddenError("the change is not ready for approval");
  }
  if (
    !row.rollbackPlan?.trim() ||
    row.riskLevel == null ||
    !row.impactAssessment?.trim()
  ) {
    throw new ForbiddenError(
      "risk, impact, and a rollback plan are required before approval",
    );
  }

  // Idempotent — clears any stale PENDING request left by a prior rejected round.
  await cancelRequest(tx, {
    subjectType: "change",
    subjectId: id,
    reason: "resubmitted",
    actorId: actor.id,
  });

  const highRisk = row.riskLevel === "HIGH";
  const policyKey = highRisk ? "change.high_risk" : "change.standard";
  await openApprovalRequest(tx, {
    subjectType: "change",
    subjectId: id,
    createdById: row.ownerId,
    policyKey,
    steps: highRisk
      ? [
          { order: 1, requiredHat: "TECHNICAL_APPROVER" },
          { order: 2, requiredHat: "BUSINESS_APPROVER" },
        ]
      : [{ order: 1, requiredHat: "TECHNICAL_APPROVER" }],
  });

  assertTransition("ASSESSING", "APPROVAL");
  await tx.change.update({ where: { id }, data: { status: "APPROVAL" } });

  await writeAudit(tx, {
    actorId: actor.id,
    action: "change.submitted_for_approval",
    subjectType: "Change",
    subjectId: id,
    payload: { policyKey },
  });
  await writeAudit(tx, {
    actorId: actor.id,
    action: "change.advanced",
    subjectType: "Change",
    subjectId: id,
    payload: { from: "ASSESSING", to: "APPROVAL" },
  });
}

/**
 * The narrow read the `POST /api/changes/:id/approve/:tier` route needs to build
 * the `authorize` subject and locate the step awaiting a decision. `currentStepId`
 * / `currentRequiredHat` are non-null ONLY while the request is PENDING — a
 * REJECTED / CANCELLED / APPROVED request's `currentStep` still points at an
 * unfilled step, and no decision may be offered on it.
 */
export async function changeApprovalContext(
  id: string,
  client: PrismaClient = prisma,
): Promise<{
  ownerId: string;
  riskLevel: $Enums.Level | null;
  status: $Enums.ChangeStatus;
  currentStepId: string | null;
  currentRequiredHat: $Enums.Hat | null;
}> {
  const row = await client.change.findUnique({
    where: { id },
    select: { ownerId: true, riskLevel: true, status: true },
  });
  if (!row) throw new NotFoundError("not found");

  const approval = await getApprovalState("change", id, client);
  const step = approval.status === "PENDING" ? approval.currentStep : null;

  return {
    ownerId: row.ownerId,
    riskLevel: row.riskLevel,
    status: row.status,
    currentStepId: step?.id ?? null,
    currentRequiredHat: step?.requiredHat ?? null,
  };
}
