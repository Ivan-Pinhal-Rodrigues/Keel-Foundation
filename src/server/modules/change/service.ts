import type { $Enums, Prisma, PrismaClient } from "@prisma/client";
import { auditActionLabel } from "@/server/audit/labels";
import { writeAudit } from "@/server/audit/write";
import { prisma } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import type { PrismaTransaction } from "@/server/db/tx";
import { nextRef } from "@/server/ids/ref";
import { getApprovalState } from "@/server/modules/approval/service";
import type { Actor } from "@/server/policy/actor";
import { authorize } from "@/server/policy/authorize";
import { ForbiddenError, NotFoundError } from "@/server/policy/errors";
import { requireInternal } from "@/server/policy/subjects/helpers";
import { serializeChange, serializeChangeListItem } from "./serialize";

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
