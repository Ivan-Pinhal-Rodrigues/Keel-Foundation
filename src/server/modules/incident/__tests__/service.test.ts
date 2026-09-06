import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { runWithContext } from "@/server/context";
import { dueAtFrom } from "@/server/modules/incident/priority";
import {
  assignIncident,
  categorizeIncident,
  createIncident,
  getIncidentForActor,
  listIncidents,
  reopenIncident,
  transitionIncident,
} from "@/server/modules/incident/service";
import type { Actor, Hat } from "@/server/policy/actor";
import { ForbiddenError, NotFoundError } from "@/server/policy/errors";

const db = withTestDb();
const ctx = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithContext({ requestId: "r", actorId: "sys" }, fn);

const rand = () => Math.random().toString(16).slice(2);

async function seedClientAndGuest() {
  const client = await db().client.create({
    data: { name: `N-${rand()}`, isActive: true },
  });
  const guest = await db().user.create({
    data: {
      email: `g-${client.id}@k`,
      passwordHash: "x",
      displayName: "G",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  return {
    client,
    guest,
    guestActor: {
      id: guest.id,
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    } as Actor,
  };
}

async function seedInternal(
  hats: Hat[] = [],
): Promise<{ id: string; actor: Actor }> {
  const user = await db().user.create({
    data: {
      email: `i-${rand()}@k`,
      passwordHash: "x",
      displayName: "I",
      kind: "INTERNAL",
      hats,
    },
  });
  return {
    id: user.id,
    actor: { id: user.id, kind: "INTERNAL", hats, clientId: null },
  };
}

test("an internal user reports an incident: ref allocated, priority + dueAt derived, no client, audit written", async () => {
  const { actor } = await seedInternal(["DEVELOPER"]);

  const { id, ref } = await ctx(() =>
    db().$transaction((tx) =>
      createIncident(actor, tx, {
        kind: "INTERNAL",
        title: "Exports 500",
        description: "export endpoint failing",
        affectedService: "billing",
        impact: "HIGH",
        urgency: "MEDIUM",
      }),
    ),
  );

  expect(ref).toMatch(/^INC-\d{4}$/);
  const row = await db().incident.findUniqueOrThrow({ where: { id } });
  // impact HIGH, urgency MEDIUM -> P2 -> dueAt = createdAt + 24h.
  expect(row.priority).toBe("P2");
  expect(row.dueAt.getTime() - row.createdAt.getTime()).toBe(
    24 * 60 * 60 * 1000,
  );
  expect(row.status).toBe("NEW");
  expect(row.reportedById).toBe(actor.id);
  expect(row.clientId).toBeNull();
  expect(row.overdue).toBe(false);

  const audit = await db().auditEvent.findMany({
    where: { action: "incident.create", subjectId: id },
  });
  expect(audit).toHaveLength(1);
});

test("a guest reports an incident: impact/urgency forced MEDIUM, priority provisional P3, affectingLevel appended to description, clientId + reportedById server-side", async () => {
  const { client, guestActor } = await seedClientAndGuest();
  const internal = await seedInternal(["DEVELOPER"]);

  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createIncident(guestActor, tx, {
        kind: "GUEST",
        title: "Cannot log in",
        description: "portal rejects my password",
        affectedService: "portal",
        affectingLevel: "blocks the whole team",
      }),
    ),
  );

  const row = await db().incident.findUniqueOrThrow({ where: { id } });
  expect(row.impact).toBe("MEDIUM");
  expect(row.urgency).toBe("MEDIUM");
  expect(row.priority).toBe("P3");
  expect(row.clientId).toBe(client.id);
  expect(row.reportedById).toBe(guestActor.id);
  expect(row.description).toBe(
    "portal rejects my password\n\nHow much it is affecting you: blocks the whole team",
  );

  const notes = await db().notification.findMany({ where: { subjectId: id } });
  expect(notes.map((n) => n.userId)).toContain(internal.id);
  expect(notes.every((n) => n.kind === "ASSIGNED")).toBe(true);
});

test("guest list is scoped to the guest's own client; a cross-client get is a 404", async () => {
  const one = await seedClientAndGuest();
  const two = await seedClientAndGuest();

  await ctx(() =>
    db().$transaction((tx) =>
      createIncident(one.guestActor, tx, {
        kind: "GUEST",
        title: "mine",
        description: "d",
        affectedService: "s",
        affectingLevel: "a lot",
      }),
    ),
  );
  const { id: otherId } = await ctx(() =>
    db().$transaction((tx) =>
      createIncident(two.guestActor, tx, {
        kind: "GUEST",
        title: "theirs",
        description: "d",
        affectedService: "s",
        affectingLevel: "a lot",
      }),
    ),
  );

  const list = await listIncidents(one.guestActor, {}, db());
  expect(list.map((i) => i.title)).toEqual(["mine"]);

  await expect(
    getIncidentForActor(one.guestActor, otherId, db()),
  ).rejects.toBeInstanceOf(NotFoundError);
});

test("getIncidentForActor for an internal actor includes linkedChanges and the activity timeline; for a guest it omits linkedChanges and the timeline drops internal-only events", async () => {
  const { guestActor } = await seedClientAndGuest();
  const internal = await seedInternal(["DEVELOPER"]);

  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createIncident(guestActor, tx, {
        kind: "GUEST",
        title: "t",
        description: "d",
        affectedService: "s",
        affectingLevel: "a lot",
      }),
    ),
  );
  await db().auditEvent.create({
    data: {
      action: "incident.assigned",
      subjectType: "Incident",
      subjectId: id,
      requestId: "r",
      actorId: internal.id,
    },
  });

  const asInternal = await getIncidentForActor(internal.actor, id, db());
  expect(asInternal.linkedChanges).toEqual([]);
  const internalActivity = asInternal.activity as { text: string }[];
  expect(internalActivity.map((a) => a.text)).toEqual(
    expect.arrayContaining(["Incident reported", "Assigned"]),
  );

  const asGuest = await getIncidentForActor(guestActor, id, db());
  expect(asGuest).not.toHaveProperty("linkedChanges");
  const guestActivity = asGuest.activity as { text: string }[];
  expect(guestActivity.map((a) => a.text)).toContain("Problem reported");
  expect(guestActivity.map((a) => a.text)).not.toContain("Assigned");
});

test("listIncidents ?overdue filter and ?mine filter", async () => {
  const dev = await seedInternal(["DEVELOPER"]);

  const overdue = await db().incident.create({
    data: {
      ref: `INC-${rand()}`,
      title: "old",
      description: "d",
      affectedService: "s",
      impact: "MEDIUM",
      urgency: "MEDIUM",
      priority: "P3",
      status: "IN_PROGRESS",
      reportedById: dev.id,
      dueAt: new Date(Date.now() - 60 * 60 * 1000),
      overdue: true,
    },
  });
  const fresh = await db().incident.create({
    data: {
      ref: `INC-${rand()}`,
      title: "new",
      description: "d",
      affectedService: "s",
      impact: "MEDIUM",
      urgency: "MEDIUM",
      priority: "P3",
      status: "NEW",
      reportedById: dev.id,
      dueAt: new Date(Date.now() + 60 * 60 * 1000),
      overdue: false,
    },
  });

  const overdueList = await listIncidents(dev.actor, { overdue: true }, db());
  expect(overdueList.map((i) => i.id)).toEqual([overdue.id]);

  await db().incident.update({
    where: { id: fresh.id },
    data: { assigneeId: dev.id },
  });
  const mineList = await listIncidents(dev.actor, { mine: true }, db());
  expect(mineList.map((i) => i.id)).toEqual([fresh.id]);
});

/** Seed an incident row directly, with sensible defaults the caller can override. */
async function seedIncident(
  reportedById: string,
  overrides: Partial<{
    status: "NEW" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
    impact: "LOW" | "MEDIUM" | "HIGH";
    urgency: "LOW" | "MEDIUM" | "HIGH";
    priority: "P1" | "P2" | "P3" | "P4";
    createdAt: Date;
    dueAt: Date;
    assigneeId: string;
  }> = {},
) {
  const createdAt = overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z");
  const priority = overrides.priority ?? "P4";
  return db().incident.create({
    data: {
      ref: `INC-${rand()}`,
      title: "seeded",
      description: "d",
      affectedService: "s",
      impact: overrides.impact ?? "LOW",
      urgency: overrides.urgency ?? "LOW",
      priority,
      status: overrides.status ?? "NEW",
      reportedById,
      assigneeId: overrides.assigneeId ?? null,
      dueAt: overrides.dueAt ?? dueAtFrom(priority, createdAt),
      overdue: false,
      createdAt,
    },
  });
}

test("categorize while NEW: recomputes priority and dueAt, incident.categorized audited", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const inc = await seedIncident(dev.id, { createdAt });

  await ctx(() =>
    db().$transaction((tx) =>
      categorizeIncident(dev.actor, tx, inc.id, {
        impact: "HIGH",
        urgency: "HIGH",
      }),
    ),
  );

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.priority).toBe("P1");
  expect(row.dueAt.getTime() - createdAt.getTime()).toBe(4 * 60 * 60 * 1000);

  const audit = await db().auditEvent.findMany({
    where: { action: "incident.categorized", subjectId: inc.id },
  });
  expect(audit).toHaveLength(1);
  expect(audit[0]!.payload).toMatchObject({
    impact: "HIGH",
    urgency: "HIGH",
    priority: "P1",
  });
});

test("categorize after work started requires a reason; the reason is audited and added as an internal comment; dueAt is NOT recomputed", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const frozenDue = new Date("2026-03-03T03:03:03.000Z");
  const inc = await seedIncident(dev.id, {
    status: "IN_PROGRESS",
    dueAt: frozenDue,
  });

  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        categorizeIncident(dev.actor, tx, inc.id, {
          impact: "HIGH",
          urgency: "HIGH",
        }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);

  await ctx(() =>
    db().$transaction((tx) =>
      categorizeIncident(dev.actor, tx, inc.id, {
        impact: "HIGH",
        urgency: "HIGH",
        reason: "root cause reclassified after investigation",
      }),
    ),
  );

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.priority).toBe("P1");
  expect(row.dueAt.getTime()).toBe(frozenDue.getTime());

  const comments = await db().comment.findMany({
    where: { subjectType: "Incident", subjectId: inc.id },
  });
  expect(comments).toHaveLength(1);
  expect(comments[0]!.visibleToClient).toBe(false);

  const audit = await db().auditEvent.findMany({
    where: { action: "incident.categorized", subjectId: inc.id },
  });
  expect(audit).toHaveLength(1);
  expect(audit[0]!.payload).toMatchObject({
    reason: "root cause reclassified after investigation",
  });
});

test("assign to an internal user: NEW → ASSIGNED, assignee notified, incident.assigned audited", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const assignee = await seedInternal([]);
  const inc = await seedIncident(dev.id, { status: "NEW" });

  await ctx(() =>
    db().$transaction((tx) =>
      assignIncident(dev.actor, tx, inc.id, { assigneeId: assignee.id }),
    ),
  );

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.status).toBe("ASSIGNED");
  expect(row.assigneeId).toBe(assignee.id);

  const notes = await db().notification.findMany({
    where: { subjectId: inc.id, kind: "ASSIGNED" },
  });
  expect(notes.filter((n) => n.userId === assignee.id)).toHaveLength(1);

  const audit = await db().auditEvent.findMany({
    where: { action: "incident.assigned", subjectId: inc.id },
  });
  expect(audit).toHaveLength(1);
  expect(audit[0]!.payload).toMatchObject({
    assigneeId: assignee.id,
    from: "NEW",
    to: "ASSIGNED",
  });
});

test("assigning a guest user is rejected (ForbiddenError)", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const { guest } = await seedClientAndGuest();
  const inc = await seedIncident(dev.id, { status: "NEW" });

  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        assignIncident(dev.actor, tx, inc.id, { assigneeId: guest.id }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.status).toBe("NEW");
  expect(row.assigneeId).toBeNull();
});

test("assigning a RESOLVED incident is rejected", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const assignee = await seedInternal([]);
  const inc = await seedIncident(dev.id, { status: "RESOLVED" });

  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        assignIncident(dev.actor, tx, inc.id, { assigneeId: assignee.id }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("re-assign while ASSIGNED keeps the status and re-notifies the new assignee", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const first = await seedInternal([]);
  const second = await seedInternal([]);
  const inc = await seedIncident(dev.id, {
    status: "ASSIGNED",
    assigneeId: first.id,
  });

  await ctx(() =>
    db().$transaction((tx) =>
      assignIncident(dev.actor, tx, inc.id, { assigneeId: second.id }),
    ),
  );

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.status).toBe("ASSIGNED");
  expect(row.assigneeId).toBe(second.id);

  const notes = await db().notification.findMany({
    where: { subjectId: inc.id, kind: "ASSIGNED", userId: second.id },
  });
  expect(notes).toHaveLength(1);

  const audit = await db().auditEvent.findMany({
    where: { action: "incident.assigned", subjectId: inc.id },
  });
  expect(audit).toHaveLength(1);
  expect(audit[0]!.payload).toMatchObject({ assigneeId: second.id });
  expect(audit[0]!.payload).not.toHaveProperty("from");
});

test("ASSIGNED → IN_PROGRESS → RESOLVED (with resolution) → CLOSED: each transition audited, guest reporter notified + emailed", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const { guest, guestActor } = await seedClientAndGuest();

  const inc = await ctx(() =>
    db().$transaction((tx) =>
      createIncident(guestActor, tx, {
        kind: "GUEST",
        title: "cannot log in",
        description: "d",
        affectedService: "portal",
        affectingLevel: "whole team",
      }),
    ),
  );
  await ctx(() =>
    db().$transaction((tx) =>
      assignIncident(dev.actor, tx, inc.id, { assigneeId: dev.id }),
    ),
  );

  await ctx(() =>
    db().$transaction((tx) =>
      transitionIncident(dev.actor, tx, inc.id, { to: "IN_PROGRESS" }),
    ),
  );
  await ctx(() =>
    db().$transaction((tx) =>
      transitionIncident(dev.actor, tx, inc.id, {
        to: "RESOLVED",
        resolution: "restarted the auth service",
      }),
    ),
  );
  await ctx(() =>
    db().$transaction((tx) =>
      transitionIncident(dev.actor, tx, inc.id, { to: "CLOSED" }),
    ),
  );

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.status).toBe("CLOSED");
  expect(row.resolution).toBe("restarted the auth service");
  expect(row.resolvedAt).not.toBeNull();
  expect(row.closedAt).not.toBeNull();

  const transitioned = await db().auditEvent.findMany({
    where: { subjectId: inc.id, action: "incident.transitioned" },
  });
  expect(transitioned).toHaveLength(1);
  expect(transitioned[0]!.payload).toMatchObject({
    from: "ASSIGNED",
    to: "IN_PROGRESS",
  });
  const resolved = await db().auditEvent.findMany({
    where: { subjectId: inc.id, action: "incident.resolved" },
  });
  expect(resolved).toHaveLength(1);
  expect(resolved[0]!.payload).toMatchObject({
    resolution: "restarted the auth service",
  });
  expect(
    await db().auditEvent.findMany({
      where: { subjectId: inc.id, action: "incident.closed" },
    }),
  ).toHaveLength(1);

  const notes = await db().notification.findMany({
    where: { subjectId: inc.id, kind: "STATUS_CHANGED", userId: guest.id },
  });
  expect(notes).toHaveLength(3);

  const outbox = await db().emailOutbox.findMany({
    where: { toEmail: guest.email, template: "incident_status" },
  });
  expect(outbox).toHaveLength(3);
  expect(outbox.map((o) => (o.payload as { status: string }).status)).toEqual(
    expect.arrayContaining(["Investigating", "Resolved", "Closed"]),
  );
});

test("RESOLVED without resolution text is rejected", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const inc = await seedIncident(dev.id, { status: "IN_PROGRESS" });

  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        transitionIncident(dev.actor, tx, inc.id, { to: "RESOLVED" }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.status).toBe("IN_PROGRESS");
});

test("CLOSED only from RESOLVED", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const inc = await seedIncident(dev.id, { status: "IN_PROGRESS" });

  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        transitionIncident(dev.actor, tx, inc.id, { to: "CLOSED" }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("reopen from RESOLVED → IN_PROGRESS any time; clears resolvedAt/closedAt; incident.reopened audited", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const inc = await seedIncident(dev.id, { status: "RESOLVED" });
  await db().incident.update({
    where: { id: inc.id },
    data: {
      resolution: "was a config typo",
      resolvedAt: new Date("2026-01-02T00:00:00.000Z"),
    },
  });

  await ctx(() =>
    db().$transaction((tx) =>
      reopenIncident(dev.actor, tx, inc.id, { reason: "regression reported" }),
    ),
  );

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.status).toBe("IN_PROGRESS");
  expect(row.resolvedAt).toBeNull();
  expect(row.closedAt).toBeNull();

  const audit = await db().auditEvent.findMany({
    where: { subjectId: inc.id, action: "incident.reopened" },
  });
  expect(audit).toHaveLength(1);
  expect(audit[0]!.payload).toMatchObject({
    from: "RESOLVED",
    reason: "regression reported",
  });
});

test("reopen from CLOSED within 14 days works; past 14 days → ForbiddenError", async () => {
  const dev = await seedInternal(["DEVELOPER"]);

  const fresh = await seedIncident(dev.id, { status: "CLOSED" });
  await db().incident.update({
    where: { id: fresh.id },
    data: { closedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
  });
  await ctx(() =>
    db().$transaction((tx) =>
      reopenIncident(dev.actor, tx, fresh.id, { reason: "still broken" }),
    ),
  );
  expect(
    (await db().incident.findUniqueOrThrow({ where: { id: fresh.id } })).status,
  ).toBe("IN_PROGRESS");

  const stale = await seedIncident(dev.id, { status: "CLOSED" });
  await db().incident.update({
    where: { id: stale.id },
    data: { closedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
  });
  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        reopenIncident(dev.actor, tx, stale.id, { reason: "too late now" }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);
  expect(
    (await db().incident.findUniqueOrThrow({ where: { id: stale.id } })).status,
  ).toBe("CLOSED");
});

test("transitionIncident rejects to:IN_PROGRESS unless the incident is ASSIGNED (reopen-window bypass)", async () => {
  const dev = await seedInternal(["DEVELOPER"]);

  const resolved = await seedIncident(dev.id, { status: "RESOLVED" });
  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        transitionIncident(dev.actor, tx, resolved.id, { to: "IN_PROGRESS" }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);
  expect(
    (await db().incident.findUniqueOrThrow({ where: { id: resolved.id } }))
      .status,
  ).toBe("RESOLVED");

  const closed = await seedIncident(dev.id, { status: "CLOSED" });
  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        transitionIncident(dev.actor, tx, closed.id, { to: "IN_PROGRESS" }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);
  expect(
    (await db().incident.findUniqueOrThrow({ where: { id: closed.id } }))
      .status,
  ).toBe("CLOSED");
});

test("listIncidents ignores status/priority filters for a guest but applies them for an internal actor", async () => {
  const { client, guestActor } = await seedClientAndGuest();
  const dev = await seedInternal(["DEVELOPER"]);

  await db().incident.create({
    data: {
      ref: `INC-${rand()}`,
      title: "guest-p1",
      description: "d",
      affectedService: "s",
      impact: "MEDIUM",
      urgency: "MEDIUM",
      priority: "P1",
      status: "ASSIGNED",
      reportedById: guestActor.id,
      clientId: client.id,
      dueAt: new Date(Date.now() + 3600_000),
      overdue: false,
    },
  });
  await db().incident.create({
    data: {
      ref: `INC-${rand()}`,
      title: "guest-p3",
      description: "d",
      affectedService: "s",
      impact: "MEDIUM",
      urgency: "MEDIUM",
      priority: "P3",
      status: "NEW",
      reportedById: guestActor.id,
      clientId: client.id,
      dueAt: new Date(Date.now() + 3600_000),
      overdue: false,
    },
  });

  const guestList = await listIncidents(
    guestActor,
    { priority: "P1", status: "ASSIGNED" },
    db(),
  );
  expect(guestList.map((i) => i.title).sort()).toEqual([
    "guest-p1",
    "guest-p3",
  ]);

  const internalList = await listIncidents(
    dev.actor,
    { priority: "P1", status: "ASSIGNED" },
    db(),
  );
  expect(internalList.map((i) => i.title)).toEqual(["guest-p1"]);
});

test("in-app status-change summary uses internal vocab for internal recipients; the guest email keeps the plain word", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const assignee = await seedInternal([]);
  const { guest, guestActor } = await seedClientAndGuest();

  const inc = await ctx(() =>
    db().$transaction((tx) =>
      createIncident(guestActor, tx, {
        kind: "GUEST",
        title: "cannot log in",
        description: "d",
        affectedService: "portal",
        affectingLevel: "whole team",
      }),
    ),
  );
  await ctx(() =>
    db().$transaction((tx) =>
      assignIncident(dev.actor, tx, inc.id, { assigneeId: assignee.id }),
    ),
  );
  await ctx(() =>
    db().$transaction((tx) =>
      transitionIncident(dev.actor, tx, inc.id, { to: "IN_PROGRESS" }),
    ),
  );

  const assigneeNote = await db().notification.findFirst({
    where: { subjectId: inc.id, kind: "STATUS_CHANGED", userId: assignee.id },
  });
  const summary = (assigneeNote?.payload as { summary: string }).summary;
  expect(summary).toContain("In progress");
  expect(summary).not.toContain("Investigating");

  const email = await db().emailOutbox.findFirst({
    where: { toEmail: guest.email, template: "incident_status" },
  });
  expect((email?.payload as { status: string }).status).toBe("Investigating");
});

test("a guest cannot transition or reopen (ForbiddenError)", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const { guestActor } = await seedClientAndGuest();
  const inc = await seedIncident(dev.id, { status: "IN_PROGRESS" });

  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        transitionIncident(guestActor, tx, inc.id, {
          to: "RESOLVED",
          resolution: "x",
        }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);

  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        reopenIncident(guestActor, tx, inc.id, { reason: "let me in" }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.status).toBe("IN_PROGRESS");
});
