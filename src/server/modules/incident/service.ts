import type { $Enums, Prisma, PrismaClient } from "@prisma/client";
import { auditActionLabel, guestAuditActionLabel } from "@/server/audit/labels";
import { writeAudit } from "@/server/audit/write";
import { prisma } from "@/server/db/client";
import type { PrismaTransaction } from "@/server/db/tx";
import { nextRef } from "@/server/ids/ref";
import { addComment } from "@/server/modules/comment";
import { emitNotification } from "@/server/modules/notify/emit";
import { type Actor, isInternal } from "@/server/policy/actor";
import { authorize } from "@/server/policy/authorize";
import { ForbiddenError, NotFoundError } from "@/server/policy/errors";
import { assertVisibleToGuest, scopeToClient } from "@/server/policy/scope";
import { dueAtFrom, priorityFor } from "./priority";
import { guestIncidentStatusLabel, serializeIncident } from "./serialize";
import { REOPEN_WINDOW_MS, assertTransition } from "./state";

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

/**
 * The categorise + assign writes (`plans/plan-02-incident.md` Task 5). Each takes
 * the caller's `tx` so the incident row, its `AuditEvent`, and any notification
 * or comment commit or roll back together. Gate before the load, uniformly with
 * the demand module: an unauthorised caller is denied whether or not the id
 * exists, so the endpoint cannot be used to probe for incidents.
 */

/** Load an incident by id or 404. */
async function loadIncidentOr404(tx: PrismaTransaction, id: string) {
  const row = await tx.incident.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("not found");
  return row;
}

/**
 * Re-categorise an incident: set impact / urgency and the derived priority.
 *
 * Plan ruling 5 — the categorisation lock: while the incident is `NEW` or
 * `ASSIGNED`, impact / urgency are freely editable and `dueAt` is recomputed
 * from the new priority. Once work has started (`IN_PROGRESS` or later) a
 * non-empty `reason` is required; it is written to the `incident.categorized`
 * audit payload and added as an internal (client-invisible) comment, and
 * `dueAt` is left untouched.
 */
export async function categorizeIncident(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: { impact: $Enums.Level; urgency: $Enums.Level; reason?: string },
): Promise<void> {
  authorize(actor, "incident.categorize", { type: "incident", id });
  const row = await loadIncidentOr404(tx, id);

  const locked = row.status !== "NEW" && row.status !== "ASSIGNED";
  const reason = input.reason?.trim();
  if (locked && !reason) {
    throw new ForbiddenError(
      "categorisation is locked once work has started — a reason is required",
    );
  }

  const priority = priorityFor(input.impact, input.urgency);
  // The SLA clock only moves while the incident is pre-work.
  const nextDueAt = locked ? row.dueAt : dueAtFrom(priority, row.createdAt);

  const data: Prisma.IncidentUpdateInput = {
    impact: input.impact,
    urgency: input.urgency,
    priority,
    ...(locked ? {} : { dueAt: nextDueAt }),
  };
  await tx.incident.update({ where: { id }, data });

  await writeAudit(tx, {
    actorId: actor.id,
    action: "incident.categorized",
    subjectType: "Incident",
    subjectId: id,
    payload: {
      impact: input.impact,
      urgency: input.urgency,
      priority,
      dueAt: nextDueAt,
      ...(reason ? { reason } : {}),
    },
  });

  if (locked && reason) {
    await addComment(tx, {
      actor,
      subject: { type: "Incident", id, clientId: row.clientId },
      body: `Re-categorised: ${reason}`,
      visibleToClient: false,
    });
  }
}

/**
 * Assign an incident to an internal user.
 *
 * Plan ruling 4 — the assignee must be an active internal user; assigning an
 * incident that is still `NEW` also advances it to `ASSIGNED` in the same write.
 * Re-assignment is allowed while `NEW` / `ASSIGNED` / `IN_PROGRESS`; a
 * `RESOLVED` or `CLOSED` incident cannot be assigned. The new assignee is
 * notified.
 */
export async function assignIncident(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: { assigneeId: string },
): Promise<void> {
  authorize(actor, "incident.assign", { type: "incident", id });
  const row = await loadIncidentOr404(tx, id);

  if (row.status === "RESOLVED" || row.status === "CLOSED") {
    throw new ForbiddenError("cannot assign a resolved or closed incident");
  }

  const assignee = await tx.user.findUnique({
    where: { id: input.assigneeId },
    select: { kind: true, isActive: true },
  });
  if (!assignee || assignee.kind !== "INTERNAL" || !assignee.isActive) {
    throw new ForbiddenError("assignee must be an active internal user");
  }

  const nextStatus: $Enums.IncidentStatus =
    row.status === "NEW" ? "ASSIGNED" : row.status;
  const advanced = nextStatus !== row.status;
  if (advanced) assertTransition(row.status, nextStatus);

  await tx.incident.update({
    where: { id },
    data: { assigneeId: input.assigneeId, status: nextStatus },
  });

  await writeAudit(tx, {
    actorId: actor.id,
    action: "incident.assigned",
    subjectType: "Incident",
    subjectId: id,
    payload: {
      assigneeId: input.assigneeId,
      ...(advanced ? { from: row.status, to: nextStatus } : {}),
    },
  });

  await emitNotification(tx, {
    recipients: { userIds: [input.assigneeId] },
    kind: "ASSIGNED",
    subjectType: "Incident",
    subjectId: id,
    summary: `You were assigned ${row.ref}: ${row.title}`,
    excludeActorId: actor.id,
  });
}

/**
 * The work transitions (`plans/plan-02-incident.md` Task 6). `transitionIncident`
 * drives `ASSIGNED → IN_PROGRESS`, `IN_PROGRESS → RESOLVED` (a non-empty
 * `resolution` is required; `resolvedAt` stamped), and `RESOLVED → CLOSED`
 * (`closedAt` stamped). `reopenIncident` drives `RESOLVED → IN_PROGRESS` (any
 * time) and `CLOSED → IN_PROGRESS` (only within `REOPEN_WINDOW_MS` of
 * `closedAt`), clearing `resolvedAt` / `closedAt`. Each takes the caller's `tx`
 * so the row, its `AuditEvent`, and the notifications commit or roll back
 * together — gated before the load, uniformly with the rest of the module.
 */

type StatusChangeRow = {
  id: string;
  ref: string;
  title: string;
  reportedById: string;
  assigneeId: string | null;
};

/**
 * Notify the reporter (always) and the assignee (when set, and neither the
 * reporter nor the acting user) that an incident's status moved. A guest
 * reporter also gets the guest-safe `incident_status` email carrying the
 * already-rendered plain-word status.
 */
async function notifyReporterAndAssignee(
  tx: PrismaTransaction,
  args: { row: StatusChangeRow; actorId: string; guestStatus: string },
): Promise<void> {
  const { row } = args;
  const summary = `${row.ref} status updated: ${args.guestStatus}`;

  const reporter = await tx.user.findUnique({
    where: { id: row.reportedById },
    select: { kind: true },
  });
  await emitNotification(tx, {
    recipients: { userIds: [row.reportedById] },
    kind: "STATUS_CHANGED",
    subjectType: "Incident",
    subjectId: row.id,
    summary,
    email:
      reporter?.kind === "GUEST"
        ? {
            template: "incident_status",
            payload: { ref: row.ref, status: args.guestStatus },
          }
        : undefined,
  });

  if (
    row.assigneeId &&
    row.assigneeId !== row.reportedById &&
    row.assigneeId !== args.actorId
  ) {
    await emitNotification(tx, {
      recipients: { userIds: [row.assigneeId] },
      kind: "STATUS_CHANGED",
      subjectType: "Incident",
      subjectId: row.id,
      summary,
    });
  }
}

export async function transitionIncident(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: { to: "IN_PROGRESS" | "RESOLVED" | "CLOSED"; resolution?: string },
): Promise<void> {
  authorize(actor, "incident.transition", { type: "incident", id });
  const row = await loadIncidentOr404(tx, id);
  assertTransition(row.status, input.to);

  const now = new Date();
  const data: Prisma.IncidentUpdateInput = { status: input.to };
  let action: string;
  let payload: Record<string, unknown>;

  if (input.to === "RESOLVED") {
    const resolution = input.resolution?.trim();
    if (!resolution) {
      throw new ForbiddenError(
        "a resolution is required to resolve an incident",
      );
    }
    data.resolution = resolution;
    data.resolvedAt = now;
    action = "incident.resolved";
    payload = { resolution };
  } else if (input.to === "CLOSED") {
    data.closedAt = now;
    action = "incident.closed";
    payload = {};
  } else {
    action = "incident.transitioned";
    payload = { from: row.status, to: input.to };
  }

  await tx.incident.update({ where: { id }, data });
  await writeAudit(tx, {
    actorId: actor.id,
    action,
    subjectType: "Incident",
    subjectId: id,
    payload,
  });
  await notifyReporterAndAssignee(tx, {
    row,
    actorId: actor.id,
    guestStatus: guestIncidentStatusLabel(input.to),
  });
}

export async function reopenIncident(
  actor: Actor,
  tx: PrismaTransaction,
  id: string,
  input: { reason: string },
): Promise<void> {
  authorize(actor, "incident.transition", { type: "incident", id });
  const row = await loadIncidentOr404(tx, id);
  // Legal only from RESOLVED or CLOSED (`state.ts`).
  assertTransition(row.status, "IN_PROGRESS");

  if (row.status === "CLOSED") {
    const closedMs = row.closedAt?.getTime() ?? 0;
    if (Date.now() - closedMs > REOPEN_WINDOW_MS) {
      throw new ForbiddenError("the reopen window has closed");
    }
  }

  await tx.incident.update({
    where: { id },
    data: { status: "IN_PROGRESS", resolvedAt: null, closedAt: null },
  });
  await writeAudit(tx, {
    actorId: actor.id,
    action: "incident.reopened",
    subjectType: "Incident",
    subjectId: id,
    payload: { from: row.status, reason: input.reason.trim() },
  });
  await notifyReporterAndAssignee(tx, {
    row,
    actorId: actor.id,
    guestStatus: guestIncidentStatusLabel("IN_PROGRESS"),
  });
}
