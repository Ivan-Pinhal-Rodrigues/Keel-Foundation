import type { $Enums, PrismaClient } from "@prisma/client";
import { auditActionLabel, guestAuditActionLabel } from "@/server/audit/labels";
import { writeAudit } from "@/server/audit/write";
import { prisma } from "@/server/db/client";
import type { PrismaTransaction } from "@/server/db/tx";
import { nextRef } from "@/server/ids/ref";
import { emitNotification } from "@/server/modules/notify/emit";
import { type Actor, isInternal } from "@/server/policy/actor";
import { authorize } from "@/server/policy/authorize";
import { ForbiddenError, NotFoundError } from "@/server/policy/errors";
import { assertVisibleToGuest, scopeToClient } from "@/server/policy/scope";
import {
  requireAnyHat,
  requireInternal,
} from "@/server/policy/subjects/helpers";
import { guestStatusLabel, serializeDemand } from "./serialize";
import { assertTransition, worthComplete } from "./state";

/** The hats that may record or reject a worth decision (spec 00 §4.2). */
const WORTH_DECIDERS = ["BUSINESS_APPROVER", "TECHNICAL_APPROVER"] as const;

/**
 * The demand use cases: create / list / get (`plans/plan-01-demand.md` Task 2).
 * Every write takes the caller's `tx`; the domain row, its `AuditEvent`, and any
 * notification commit or roll back together. Reads open their own client.
 */

const DEMAND_INCLUDE = {
  worth: true,
  client: { select: { name: true } },
} as const;

export type CreateDemandInput = {
  title: string;
  problem: string;
  source: $Enums.DemandSource;
  affectedService?: string;
};

export async function createDemand(
  actor: Actor,
  tx: PrismaTransaction,
  input: CreateDemandInput,
): Promise<{ id: string; ref: string }> {
  // Always allows — kept for symmetry and the audit trail of "who was allowed".
  authorize(actor, "demand.create", { type: "demand" });

  const ref = await nextRef(tx, "DEM");
  const demand = await tx.demand.create({
    data: {
      ref,
      title: input.title,
      problem: input.problem,
      source: input.source,
      status: "SUBMITTED",
      submittedById: actor.id,
      clientId: isInternal(actor) ? null : actor.clientId,
      affectedService: input.affectedService ?? null,
    },
  });

  await writeAudit(tx, {
    actorId: actor.id,
    action: "demand.create",
    subjectType: "Demand",
    subjectId: demand.id,
    payload: { source: input.source, byGuest: !isInternal(actor) },
  });

  if (!isInternal(actor)) {
    await emitNotification(tx, {
      recipients: { audience: "ALL_INTERNAL" },
      kind: "ASSIGNED",
      subjectType: "Demand",
      subjectId: demand.id,
      summary: `New client demand: ${input.title}`,
      excludeActorId: actor.id,
    });
  }

  return { id: demand.id, ref: demand.ref };
}

export async function listDemands(
  actor: Actor,
  filters: {
    status?: $Enums.DemandStatus;
    source?: $Enums.DemandSource;
    mine?: boolean;
  },
  client: PrismaClient = prisma,
): Promise<Record<string, unknown>[]> {
  const rows = await client.demand.findMany({
    where: {
      ...scopeToClient(actor),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.source ? { source: filters.source } : {}),
      ...(filters.mine ? { submittedById: actor.id } : {}),
    },
    include: DEMAND_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => serializeDemand(actor, row));
}

/** A short, stable timestamp string for a `Timeline` row ("2026-09-06 14:30"). */
function formatActivityTime(at: Date): string {
  return at.toISOString().slice(0, 16).replace("T", " ");
}

export async function getDemandForActor(
  actor: Actor,
  id: string,
  client: PrismaClient = prisma,
): Promise<Record<string, unknown>> {
  const row = await client.demand.findUnique({
    where: { id },
    include: DEMAND_INCLUDE,
  });
  if (!row) throw new NotFoundError("not found");
  assertVisibleToGuest(actor, row);
  authorize(actor, "demand.view", {
    type: "demand",
    id,
    clientId: row.clientId,
  });

  const serialized = serializeDemand(actor, row);

  // `activity` is assembled here, not a row column — it never rides the
  // `serializePick` allowlist. The guest filter is `guestAuditActionLabel`
  // returning `null` for an internal-only action, which drops the row.
  const events = await client.auditEvent.findMany({
    where: { subjectType: "Demand", subjectId: id },
    orderBy: { at: "asc" },
    select: { action: true, at: true, actorId: true },
  });
  const guest = !isInternal(actor);
  const activity = events.flatMap((e) => {
    const text = guest
      ? guestAuditActionLabel(e.action)
      : auditActionLabel(e.action);
    return text == null ? [] : [{ time: formatActivityTime(e.at), text }];
  });

  return { ...serialized, activity };
}

/**
 * The demand's real `clientId` — a narrow read the comments route needs to build
 * a `CommentSubject` (the guest-serialized demand omits `clientId`). Keeps the
 * Prisma boundary: the route imports this, never `@/server/db/client`.
 */
export async function demandClientId(
  id: string,
  client: PrismaClient = prisma,
): Promise<string | null> {
  const row = await client.demand.findUnique({
    where: { id },
    select: { clientId: true },
  });
  return row?.clientId ?? null;
}

/**
 * The demand lifecycle writes: triage pick-up, value/effort scoring, and the
 * cost-of-delay edit (`plans/plan-01-demand.md` Task 3). Each takes the caller's
 * `tx` so the domain write, its `AuditEvent`, and any `Notification` commit or
 * roll back together. The `TRIAGING → WORTH_ASSESSED` step is implicit: it fires
 * from any of the three scoring writes the moment `worthComplete` is satisfied
 * (`state.ts`), and — per spec §6, whose event list has no `demand.worth_assessed`
 * — carries no audit event of its own.
 */

/** Load a demand by id or 404. */
async function loadDemandOr404(tx: PrismaTransaction, id: string) {
  const row = await tx.demand.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("not found");
  return row;
}

/** After a scoring write: if the worth row is now complete and the demand is
 *  still in triage, flip it to WORTH_ASSESSED. No audit event (see above). */
async function maybeCompleteWorth(
  tx: PrismaTransaction,
  id: string,
  currentStatus: $Enums.DemandStatus,
): Promise<void> {
  if (currentStatus !== "TRIAGING") return;
  const worth = await tx.worthAssessment.findUnique({
    where: { demandId: id },
  });
  if (worth && worthComplete(worth)) {
    assertTransition("TRIAGING", "WORTH_ASSESSED");
    await tx.demand.update({
      where: { id },
      data: { status: "WORTH_ASSESSED" },
    });
  }
}

export async function startTriage(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
): Promise<void> {
  // Gate before the load, uniformly across this module: an unauthorised caller
  // is denied (403) whether or not the id exists, so the endpoint cannot be used
  // to probe for demands. "An internal user picks up a demand" — there is no
  // `demand.triage` action; the only gate is that the actor is internal.
  requireInternal(actor);
  const row = await loadDemandOr404(tx, id);
  assertTransition(row.status, "TRIAGING");

  await tx.demand.update({ where: { id }, data: { status: "TRIAGING" } });
  await tx.worthAssessment.upsert({
    where: { demandId: id },
    create: { demandId: id },
    update: {},
  });
  await writeAudit(tx, {
    actorId: actor.id,
    action: "demand.triage_started",
    subjectType: "Demand",
    subjectId: id,
    payload: { from: row.status },
  });
  // spec §7: "the other internal user" — ALL_INTERNAL minus the actor.
  await emitNotification(tx, {
    recipients: { audience: "ALL_INTERNAL" },
    kind: "STATUS_CHANGED",
    subjectType: "Demand",
    subjectId: id,
    summary: `Triage started on ${row.ref}: ${row.title}`,
    excludeActorId: actor.id,
  });
}

export async function scoreValue(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: { businessValue: string; valueScore?: number },
): Promise<void> {
  authorize(actor, "demand.score.value", { type: "demand", id });
  const row = await loadDemandOr404(tx, id);
  if (row.status !== "TRIAGING") {
    throw new ForbiddenError("value can only be scored during triage");
  }

  await tx.worthAssessment.update({
    where: { demandId: id },
    data: {
      businessValue: input.businessValue,
      valueScore: input.valueScore ?? null,
      valueScoredById: actor.id,
    },
  });
  await writeAudit(tx, {
    actorId: actor.id,
    action: "demand.value_scored",
    subjectType: "Demand",
    subjectId: id,
    payload: { valueScore: input.valueScore ?? null },
  });
  await maybeCompleteWorth(tx, id, row.status);
  await emitNotification(tx, {
    recipients: { hat: "TECHNICAL_APPROVER" },
    kind: "STATUS_CHANGED",
    subjectType: "Demand",
    subjectId: id,
    summary: `Business value scored on ${row.ref}: ${row.title}`,
    excludeActorId: actor.id,
  });
}

export async function scoreEffort(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: { effort: $Enums.Effort; feasibility?: string },
): Promise<void> {
  authorize(actor, "demand.score.effort", { type: "demand", id });
  const row = await loadDemandOr404(tx, id);
  if (row.status !== "TRIAGING") {
    throw new ForbiddenError("effort can only be scored during triage");
  }

  await tx.worthAssessment.update({
    where: { demandId: id },
    data: {
      effort: input.effort,
      feasibility: input.feasibility ?? null,
      effortScoredById: actor.id,
    },
  });
  await writeAudit(tx, {
    actorId: actor.id,
    action: "demand.effort_scored",
    subjectType: "Demand",
    subjectId: id,
    payload: { effort: input.effort },
  });
  await maybeCompleteWorth(tx, id, row.status);
  await emitNotification(tx, {
    recipients: { hat: "BUSINESS_APPROVER" },
    kind: "STATUS_CHANGED",
    subjectType: "Demand",
    subjectId: id,
    summary: `Effort scored on ${row.ref}: ${row.title}`,
    excludeActorId: actor.id,
  });
}

export async function setCostOfDelay(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: { costOfDelay: string },
): Promise<void> {
  // spec §8.2: "any internal user" edits cost of delay. There is no dedicated
  // action; `requireInternal` is the edit right — gated before the load like the
  // rest of this module (a guest is denied 403 regardless of the id).
  requireInternal(actor);
  const row = await loadDemandOr404(tx, id);

  await tx.worthAssessment.upsert({
    where: { demandId: id },
    create: { demandId: id, costOfDelay: input.costOfDelay },
    update: { costOfDelay: input.costOfDelay },
  });
  // `demand.cost_of_delay_set` is beyond spec §6's event list — a gap. Added
  // anyway: spec §8.2 makes cost of delay an editable field, so it needs an
  // audit trail.
  await writeAudit(tx, {
    actorId: actor.id,
    action: "demand.cost_of_delay_set",
    subjectType: "Demand",
    subjectId: id,
    payload: {},
  });
  await maybeCompleteWorth(tx, id, row.status);
}

/**
 * The worth decision, the outright reject, and the single-approver override
 * (`plans/plan-01-demand.md` Task 4, reconciliation ruling 4).
 *
 * `decideDemand` records `PURSUE` / `PARK` → `APPROVED`, `DROP` → `REJECTED`.
 * The SoD guard lives in the `demand.decide` policy rule: when the actor is the
 * demand's submitter it throws `SegregationError("demand.decide.override")` →
 * 409. The caller resends with a `>= 20`-char `overrideJustification`; the
 * service then runs the hat check WITHOUT the SoD guard, flags the assessment
 * `isSingleApproverOverride`, and writes BOTH a `demand.decided` and a
 * `demand.decide.override` audit event.
 *
 * A demand parked at `APPROVED` (`worth.decision === "PARK"`) may be re-decided
 * — the `APPROVED` status is not a declared source for `assertTransition`, so
 * that call is skipped for the re-decide path.
 */

/** Load a demand + its worth row, or 404. */
async function loadDemandWithWorthOr404(tx: PrismaTransaction, id: string) {
  const row = await tx.demand.findUnique({
    where: { id },
    include: { worth: true },
  });
  if (!row) throw new NotFoundError("not found");
  return row;
}

/**
 * Notify the demand's submitter of a decision / rejection outcome: in-app
 * always, plus an email when the submitter is a guest (the guest-safe
 * `demand_decided` template, carrying the already-rendered plain-word status).
 */
async function notifySubmitterOfOutcome(
  tx: PrismaTransaction,
  args: {
    demandId: string;
    submittedById: string;
    ref: string;
    summary: string;
    guestStatus: string;
  },
): Promise<void> {
  const submitter = await tx.user.findUnique({
    where: { id: args.submittedById },
    select: { kind: true },
  });
  await emitNotification(tx, {
    recipients: { userIds: [args.submittedById] },
    kind: "STATUS_CHANGED",
    subjectType: "Demand",
    subjectId: args.demandId,
    summary: args.summary,
    email:
      submitter?.kind === "GUEST"
        ? {
            template: "demand_decided",
            payload: { ref: args.ref, status: args.guestStatus },
          }
        : undefined,
  });
}

export async function decideDemand(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: {
    decision: $Enums.WorthDecision;
    note?: string;
    overrideJustification?: string;
  },
): Promise<void> {
  // Gate before the load: a guest / non-approver is denied 403 regardless of
  // the id. The SoD-aware check runs below, once the submitter is known.
  requireAnyHat(actor, WORTH_DECIDERS);

  const row = await loadDemandWithWorthOr404(tx, id);
  const worth = row.worth;

  const isSubmitter = actor.id === row.submittedById;
  const override =
    typeof input.overrideJustification === "string" &&
    input.overrideJustification.trim().length >= 20;
  const singleApproverOverride = isSubmitter && override;

  if (singleApproverOverride) {
    // Ruling 4: the hat check WITHOUT the SoD guard (already asserted above).
    requireAnyHat(actor, WORTH_DECIDERS);
  } else {
    // Throws SegregationError("demand.decide.override") for an un-justified
    // submitter — the route lets it propagate to a 409.
    authorize(actor, "demand.decide", {
      type: "demand",
      id,
      submittedById: row.submittedById,
      clientId: row.clientId,
      status: row.status,
    });
  }

  const isReDecide = row.status === "APPROVED" && worth?.decision === "PARK";
  if (row.status !== "WORTH_ASSESSED" && !isReDecide) {
    throw new ForbiddenError("demand is not awaiting a worth decision");
  }
  if (!worth || !worthComplete(worth)) {
    throw new ForbiddenError("worth assessment incomplete");
  }

  const target: $Enums.DemandStatus =
    input.decision === "DROP" ? "REJECTED" : "APPROVED";
  if (!isReDecide) assertTransition(row.status, target);

  const justification = singleApproverOverride
    ? input.overrideJustification!.trim()
    : null;

  await tx.worthAssessment.update({
    where: { demandId: id },
    data: {
      decision: input.decision,
      decisionNote: input.note ?? null,
      decidedById: actor.id,
      isSingleApproverOverride: singleApproverOverride,
      overrideJustification: justification,
    },
  });
  await tx.demand.update({
    where: { id },
    data: {
      status: target,
      decidedAt: new Date(),
      rejectionReason: input.decision === "DROP" ? (input.note ?? null) : null,
    },
  });

  await writeAudit(tx, {
    actorId: actor.id,
    action: "demand.decided",
    subjectType: "Demand",
    subjectId: id,
    payload: {
      decision: input.decision,
      valueScore: worth.valueScore,
      effort: worth.effort,
    },
  });
  if (singleApproverOverride) {
    await writeAudit(tx, {
      actorId: actor.id,
      action: "demand.decide.override",
      subjectType: "Demand",
      subjectId: id,
      payload: { justification },
    });
  }

  await notifySubmitterOfOutcome(tx, {
    demandId: id,
    submittedById: row.submittedById,
    ref: row.ref,
    summary: `Your demand "${row.title}" was ${
      input.decision === "PURSUE"
        ? "approved"
        : input.decision === "PARK"
          ? "parked"
          : "declined"
    }`,
    guestStatus: guestStatusLabel(target, input.decision, input.note ?? null),
  });
}

export async function rejectDemand(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: { reason: string },
): Promise<void> {
  authorize(actor, "demand.reject", { type: "demand", id });

  const row = await loadDemandWithWorthOr404(tx, id);

  const isReDecide =
    row.status === "APPROVED" && row.worth?.decision === "PARK";
  if (row.status !== "WORTH_ASSESSED" && !isReDecide) {
    throw new ForbiddenError("demand is not awaiting a worth decision");
  }
  if (!isReDecide) assertTransition(row.status, "REJECTED");

  if (row.worth) {
    await tx.worthAssessment.update({
      where: { demandId: id },
      data: { decision: "DROP", decidedById: actor.id },
    });
  }
  await tx.demand.update({
    where: { id },
    data: {
      status: "REJECTED",
      decidedAt: new Date(),
      rejectionReason: input.reason,
    },
  });
  await writeAudit(tx, {
    actorId: actor.id,
    action: "demand.rejected",
    subjectType: "Demand",
    subjectId: id,
    payload: { reason: input.reason },
  });
  await notifySubmitterOfOutcome(tx, {
    demandId: id,
    submittedById: row.submittedById,
    ref: row.ref,
    summary: `Your demand "${row.title}" was declined`,
    guestStatus: guestStatusLabel("REJECTED", "DROP", input.reason),
  });
}
