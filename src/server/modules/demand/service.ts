import type { $Enums, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/server/audit/write";
import { prisma } from "@/server/db/client";
import type { PrismaTransaction } from "@/server/db/tx";
import { nextRef } from "@/server/ids/ref";
import { emitNotification } from "@/server/modules/notify/emit";
import { type Actor, isInternal } from "@/server/policy/actor";
import { authorize } from "@/server/policy/authorize";
import { ForbiddenError, NotFoundError } from "@/server/policy/errors";
import { assertVisibleToGuest, scopeToClient } from "@/server/policy/scope";
import { requireInternal } from "@/server/policy/subjects/helpers";
import { serializeDemand } from "./serialize";
import { assertTransition, worthComplete } from "./state";

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
  return serializeDemand(actor, row);
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
  const row = await loadDemandOr404(tx, id);
  // "an internal user picks up a demand" — there is no `demand.triage` action;
  // the only gate is that the actor is internal.
  requireInternal(actor);
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
  const row = await loadDemandOr404(tx, id);
  authorize(actor, "demand.score.value", {
    type: "demand",
    id,
    submittedById: row.submittedById,
    clientId: row.clientId,
    status: row.status,
  });
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
  const row = await loadDemandOr404(tx, id);
  authorize(actor, "demand.score.effort", {
    type: "demand",
    id,
    submittedById: row.submittedById,
    clientId: row.clientId,
    status: row.status,
  });
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
  const row = await loadDemandOr404(tx, id);
  // spec §8.2: "any internal user" edits cost of delay. There is no dedicated
  // action — `demand.view` gives the guest cross-client 404, and `requireInternal`
  // is the edit right.
  authorize(actor, "demand.view", {
    type: "demand",
    id,
    submittedById: row.submittedById,
    clientId: row.clientId,
    status: row.status,
  });
  requireInternal(actor);

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
