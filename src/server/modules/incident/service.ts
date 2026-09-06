import type { $Enums, PrismaClient } from "@prisma/client";
import { auditActionLabel, guestAuditActionLabel } from "@/server/audit/labels";
import { writeAudit } from "@/server/audit/write";
import { prisma } from "@/server/db/client";
import type { PrismaTransaction } from "@/server/db/tx";
import { nextRef } from "@/server/ids/ref";
import { emitNotification } from "@/server/modules/notify/emit";
import { type Actor, isInternal } from "@/server/policy/actor";
import { authorize } from "@/server/policy/authorize";
import { NotFoundError } from "@/server/policy/errors";
import { assertVisibleToGuest, scopeToClient } from "@/server/policy/scope";
import { dueAtFrom, priorityFor } from "./priority";
import { serializeIncident } from "./serialize";

/**
 * The incident use cases: create (internal + guest), list, get, and the linked
 * changes helper (`plans/plan-02-incident.md` Task 4). Every write takes the
 * caller's `tx` — the domain row, its `AuditEvent`, and any notification commit
 * or roll back together. Reads open their own client.
 */

const INCIDENT_INCLUDE = {
  assignee: { select: { displayName: true } },
  client: { select: { name: true } },
} as const;

export type CreateIncidentInternalInput = {
  kind: "INTERNAL";
  title: string;
  description: string;
  affectedService: string;
  impact: $Enums.Level;
  urgency: $Enums.Level;
};

export type CreateIncidentGuestInput = {
  kind: "GUEST";
  title: string;
  description: string;
  affectedService: string;
  affectingLevel: string;
};

export async function createIncident(
  actor: Actor,
  tx: PrismaTransaction,
  input: CreateIncidentInternalInput | CreateIncidentGuestInput,
): Promise<{ id: string; ref: string }> {
  // Always allows (GUEST | INTERNAL) — kept for symmetry and the audit trail.
  authorize(actor, "incident.create", { type: "incident" });

  const ref = await nextRef(tx, "INC");

  // A guest report is provisional: impact/urgency forced MEDIUM, priority P3,
  // and the "how much is it affecting you" answer folded into the description.
  // An internal report carries a real impact/urgency and a derived priority.
  const impact: $Enums.Level =
    input.kind === "INTERNAL" ? input.impact : "MEDIUM";
  const urgency: $Enums.Level =
    input.kind === "INTERNAL" ? input.urgency : "MEDIUM";
  const priority: $Enums.Priority =
    input.kind === "INTERNAL" ? priorityFor(impact, urgency) : "P3";
  const description =
    input.kind === "GUEST"
      ? `${input.description}\n\nHow much it is affecting you: ${input.affectingLevel}`
      : input.description;

  const createdAt = new Date();
  const dueAt = dueAtFrom(priority, createdAt);

  const incident = await tx.incident.create({
    data: {
      ref,
      title: input.title,
      description,
      affectedService: input.affectedService,
      impact,
      urgency,
      priority,
      status: "NEW",
      reportedById: actor.id,
      clientId: isInternal(actor) ? null : actor.clientId,
      dueAt,
      overdue: false,
      // Pass `createdAt` explicitly so `dueAt` and the stored row agree.
      createdAt,
    },
  });

  await writeAudit(tx, {
    actorId: actor.id,
    action: "incident.create",
    subjectType: "Incident",
    subjectId: incident.id,
    payload: { priority, byGuest: !isInternal(actor) },
  });

  if (!isInternal(actor)) {
    await emitNotification(tx, {
      recipients: { audience: "ALL_INTERNAL" },
      kind: "ASSIGNED",
      subjectType: "Incident",
      subjectId: incident.id,
      summary: `New client incident: ${input.title}`,
      excludeActorId: actor.id,
    });
  }

  return { id: incident.id, ref: incident.ref };
}

export async function listIncidents(
  actor: Actor,
  filters: {
    status?: $Enums.IncidentStatus;
    priority?: $Enums.Priority;
    overdue?: boolean;
    mine?: boolean;
  },
  client: PrismaClient = prisma,
): Promise<Record<string, unknown>[]> {
  const rows = await client.incident.findMany({
    where: {
      ...scopeToClient(actor),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      // The stored column, kept honest by the overdue sweep (Task 6).
      ...(filters.overdue ? { overdue: true } : {}),
      // `mine` is an internal-only filter; a guest's list is already scoped.
      ...(filters.mine && isInternal(actor) ? { assigneeId: actor.id } : {}),
    },
    include: INCIDENT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  // The list card shows no fix line, so per-row linked changes are not needed.
  return rows.map((row) =>
    serializeIncident(actor, row, { now, linkedChanges: [] }),
  );
}

/** A short, stable timestamp string for a `Timeline` row ("2026-09-06 14:30"). */
function formatActivityTime(at: Date): string {
  return at.toISOString().slice(0, 16).replace("T", " ");
}

export async function getIncidentForActor(
  actor: Actor,
  id: string,
  client: PrismaClient = prisma,
): Promise<Record<string, unknown>> {
  const row = await client.incident.findUnique({
    where: { id },
    include: INCIDENT_INCLUDE,
  });
  if (!row) throw new NotFoundError("not found");
  assertVisibleToGuest(actor, row);
  authorize(actor, "incident.view", {
    type: "incident",
    id,
    clientId: row.clientId,
  });

  const linked = await listLinkedChanges(id, client);
  const serialized = serializeIncident(actor, row, {
    now: new Date(),
    linkedChanges: linked,
  });

  // `activity` is assembled here, not a row column — it never rides the
  // `serializePick` allowlist. The guest filter is `guestAuditActionLabel`
  // returning `null` for an internal-only action, which drops the row.
  const events = await client.auditEvent.findMany({
    where: { subjectType: "Incident", subjectId: id },
    orderBy: { at: "asc" },
    select: { action: true, at: true },
  });
  const guest = !isInternal(actor);
  const activity = events.flatMap((e) => {
    const text = guest
      ? guestAuditActionLabel(e.action)
      : auditActionLabel(e.action);
    return text == null ? [] : [{ time: formatActivityTime(e.at), text }];
  });

  // Linked changes are internal-only — the guest's fix signal already rides the
  // serializer's `fix` field.
  return {
    ...serialized,
    activity,
    ...(isInternal(actor) ? { linkedChanges: linked } : {}),
  };
}

export async function listLinkedChanges(
  incidentId: string,
  client: PrismaClient = prisma,
): Promise<
  {
    changeId: string;
    ref: string;
    kind: $Enums.LinkKind;
    status: $Enums.ChangeStatus;
  }[]
> {
  // `Change` / `ChangeIncidentLink` exist but stay empty until plan-03, so this
  // returns `[]` for now — expected.
  const links = await client.changeIncidentLink.findMany({
    where: { incidentId },
    include: { change: { select: { ref: true, status: true } } },
  });
  return links.map((link) => ({
    changeId: link.changeId,
    ref: link.change.ref,
    kind: link.kind,
    status: link.change.status,
  }));
}

/**
 * The incident's real `clientId` — a narrow read the comments route needs to
 * build a `CommentSubject` (the guest-serialized incident omits `clientId`).
 * Keeps the Prisma boundary: the route imports this, never `@/server/db/client`.
 */
export async function incidentClientId(
  id: string,
  client: PrismaClient = prisma,
): Promise<string | null> {
  const row = await client.incident.findUnique({
    where: { id },
    select: { clientId: true },
  });
  return row?.clientId ?? null;
}
