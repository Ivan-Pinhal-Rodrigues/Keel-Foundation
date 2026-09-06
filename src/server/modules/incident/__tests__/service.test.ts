import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { runWithContext } from "@/server/context";
import {
  createIncident,
  getIncidentForActor,
  listIncidents,
} from "@/server/modules/incident/service";
import type { Actor, Hat } from "@/server/policy/actor";
import { NotFoundError } from "@/server/policy/errors";

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
