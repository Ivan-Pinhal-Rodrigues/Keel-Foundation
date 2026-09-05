import type { $Enums, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/server/audit/write";
import { prisma } from "@/server/db/client";
import type { PrismaTransaction } from "@/server/db/tx";
import { nextRef } from "@/server/ids/ref";
import { emitNotification } from "@/server/modules/notify/emit";
import { type Actor, isInternal } from "@/server/policy/actor";
import { authorize } from "@/server/policy/authorize";
import { NotFoundError } from "@/server/policy/errors";
import { assertVisibleToGuest, scopeToClient } from "@/server/policy/scope";
import { serializeDemand } from "./serialize";

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
