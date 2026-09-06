import { expect, test } from "vitest";
import { runWithContext } from "@/server/context";
import {
  assignIncident,
  categorizeIncident,
  createIncident,
  getIncidentForActor,
  transitionIncident,
} from "@/server/modules/incident/service";
import { INCIDENT_GUEST_KEYS } from "@/server/modules/incident/serialize";
import { sweepOverdueIncidents } from "@/server/modules/incident/sweep";
import type { Actor } from "@/server/policy/actor";
import { withTestDb } from "@/test/db";

/**
 * Spec 02 §11 — the whole incident lifecycle end to end, at the service layer,
 * on a real disposable database. Not a unit test of any one function (those live
 * in `service.test.ts` / `sweep.test.ts`) — a regression anchor that the pieces
 * Tasks 1–11 built compose: a guest reports → an internal user categorises and
 * assigns → work → resolved → closed, audited and notified at every step, with
 * the guest only ever seeing plain words and an SLA line; plus a separate
 * overdue incident that the sweep flags exactly once.
 */

const db = withTestDb();
const ctx = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithContext({ requestId: "r", actorId: "sys" }, fn);
const rand = () => Math.random().toString(16).slice(2);

test("a guest incident is categorised, assigned, worked to resolved and closed; the guest tracks it in plain words; a separate overdue incident flags once", async () => {
  // --- seed: a client, its guest, an internal responder, an assignee -------
  // The brief's step 4 says "assign to themselves", but `assignIncident` passes
  // `excludeActorId: actor.id` — the acting user is never notified of their own
  // action, so a self-assignment emits no `ASSIGNED` notification. To keep the
  // "assignee notified" assertion meaningful (spec §8: assigned → the assignee)
  // the responder assigns to a second internal user.
  const client = await db().client.create({
    data: { name: `Northwind-${rand()}`, isActive: true },
  });
  const guest = await db().user.create({
    data: {
      email: `guest-${rand()}@nw.example`,
      passwordHash: "x",
      displayName: "Guest",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  const responder = await db().user.create({
    data: {
      email: `dev-${rand()}@keel.local`,
      passwordHash: "x",
      displayName: "Responder",
      kind: "INTERNAL",
      hats: ["DEVELOPER", "TECHNICAL_APPROVER"],
    },
  });
  const assignee = await db().user.create({
    data: {
      email: `assignee-${rand()}@keel.local`,
      passwordHash: "x",
      displayName: "Assignee",
      kind: "INTERNAL",
      hats: [],
    },
  });

  const guestActor: Actor = {
    id: guest.id,
    kind: "GUEST",
    hats: [],
    clientId: client.id,
  };
  const responderActor: Actor = {
    id: responder.id,
    kind: "INTERNAL",
    hats: ["DEVELOPER", "TECHNICAL_APPROVER"],
    clientId: null,
  };

  // --- 1. the guest reports an incident -----------------------------------
  const affectingLevel = "blocks the whole finance team from invoicing";
  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createIncident(guestActor, tx, {
        kind: "GUEST",
        title: "Cannot log in to the portal",
        description: "the portal rejects my password every time",
        affectedService: "portal",
        affectingLevel,
      }),
    ),
  );

  const created = await db().incident.findUniqueOrThrow({ where: { id } });
  expect(created.status).toBe("NEW");
  expect(created.priority).toBe("P3");
  // The "how much is it affecting you" answer is folded into the description
  // verbatim, never discarded.
  expect(created.description).toContain(affectingLevel);

  const createAudit = await db().auditEvent.findMany({
    where: { action: "incident.create", subjectId: id },
  });
  expect(createAudit).toHaveLength(1);

  const createNotes = await db().notification.findMany({
    where: { subjectId: id },
  });
  expect(
    createNotes.some((n) => n.userId === responder.id && n.kind === "ASSIGNED"),
  ).toBe(true);
  expect(createNotes.map((n) => n.userId)).not.toContain(guest.id);

  // --- 2. the responder categorises HIGH/HIGH → P1, dueAt recomputed ------
  await ctx(() =>
    db().$transaction((tx) =>
      categorizeIncident(responderActor, tx, id, {
        impact: "HIGH",
        urgency: "HIGH",
      }),
    ),
  );

  const categorised = await db().incident.findUniqueOrThrow({ where: { id } });
  expect(categorised.priority).toBe("P1");
  // `dueAt` is recomputed from the new priority while still NEW. P1's SLA (4h)
  // is tighter than P3's (72h), so the new `dueAt` is EARLIER than before — the
  // brief's parenthetical "later than before" is inverted; the assertion tracks
  // the shipped SLA table.
  expect(categorised.dueAt.getTime()).not.toBe(created.dueAt.getTime());
  expect(categorised.dueAt.getTime()).toBe(
    created.createdAt.getTime() + 4 * 60 * 60 * 1000,
  );
  expect(categorised.dueAt.getTime()).toBeLessThan(created.dueAt.getTime());

  expect(
    await db().auditEvent.findMany({
      where: { action: "incident.categorized", subjectId: id },
    }),
  ).toHaveLength(1);

  // --- 3. the responder assigns it to another internal user → ASSIGNED ----
  const assigneeNotesBefore = await db().notification.count({
    where: { subjectId: id, userId: assignee.id, kind: "ASSIGNED" },
  });
  await ctx(() =>
    db().$transaction((tx) =>
      assignIncident(responderActor, tx, id, { assigneeId: assignee.id }),
    ),
  );

  const assigned = await db().incident.findUniqueOrThrow({ where: { id } });
  expect(assigned.status).toBe("ASSIGNED");
  expect(assigned.assigneeId).toBe(assignee.id);
  const assigneeNotesAfter = await db().notification.count({
    where: { subjectId: id, userId: assignee.id, kind: "ASSIGNED" },
  });
  expect(assigneeNotesAfter).toBe(assigneeNotesBefore + 1);

  // --- 4. ASSIGNED → IN_PROGRESS -----------------------------------------
  await ctx(() =>
    db().$transaction((tx) =>
      transitionIncident(responderActor, tx, id, { to: "IN_PROGRESS" }),
    ),
  );
  const transitioned = await db().auditEvent.findMany({
    where: { subjectId: id, action: "incident.transitioned" },
  });
  expect(transitioned).toHaveLength(1);
  expect(transitioned[0]!.payload).toMatchObject({
    from: "ASSIGNED",
    to: "IN_PROGRESS",
  });

  // --- 5. IN_PROGRESS → RESOLVED (with resolution) -----------------------
  await ctx(() =>
    db().$transaction((tx) =>
      transitionIncident(responderActor, tx, id, {
        to: "RESOLVED",
        resolution: "restarted the auth service and cleared the stale sessions",
      }),
    ),
  );

  const resolved = await db().incident.findUniqueOrThrow({ where: { id } });
  expect(resolved.status).toBe("RESOLVED");
  expect(resolved.resolvedAt).not.toBeNull();

  expect(
    await db().auditEvent.findMany({
      where: { subjectId: id, action: "incident.resolved" },
    }),
  ).toHaveLength(1);
  expect(
    await db().notification.count({
      where: { subjectId: id, userId: guest.id, kind: "STATUS_CHANGED" },
    }),
  ).toBeGreaterThanOrEqual(1);

  const guestEmails = await db().emailOutbox.findMany({
    where: { toEmail: guest.email, template: "incident_status" },
  });
  expect(
    guestEmails.some(
      (o) => (o.payload as { status: string }).status === "Resolved",
    ),
  ).toBe(true);

  // --- 6. RESOLVED → CLOSED --------------------------------------------
  await ctx(() =>
    db().$transaction((tx) =>
      transitionIncident(responderActor, tx, id, { to: "CLOSED" }),
    ),
  );

  const closed = await db().incident.findUniqueOrThrow({ where: { id } });
  expect(closed.status).toBe("CLOSED");
  expect(closed.closedAt).not.toBeNull();
  expect(
    await db().auditEvent.findMany({
      where: { subjectId: id, action: "incident.closed" },
    }),
  ).toHaveLength(1);

  // --- 7. the guest view: plain words, SLA line, no internals -----------
  const view = await getIncidentForActor(guestActor, id, db());
  expect(view.status).toBe("Closed");
  expect(String(view.slaLine)).toMatch(/resolved in/i);

  expect(view).not.toHaveProperty("impact");
  expect(view).not.toHaveProperty("priority");
  expect(view).not.toHaveProperty("assigneeId");

  // Every surfaced key is on the guest allowlist (+ the derived guest fields).
  const allowed = new Set<string>([
    ...INCIDENT_GUEST_KEYS,
    "status",
    "slaLine",
    "fix",
    "resolvedAt",
    "activity",
  ]);
  for (const key of Object.keys(view)) {
    expect(allowed.has(key)).toBe(true);
  }

  const activity = (view.activity as { text: string }[]).map((a) => a.text);
  expect(activity).toEqual(
    expect.arrayContaining(["Problem reported", "Marked resolved", "Closed"]),
  );
  expect(activity).not.toContain("Assigned");
  expect(activity).not.toContain("Categorised");

  // --- 8. a separate overdue incident flags exactly once ---------------
  const pastDue = new Date(Date.now() - 60 * 60 * 1000);
  await db().incident.create({
    data: {
      ref: `INC-${rand()}`,
      title: "old and overdue",
      description: "d",
      affectedService: "s",
      impact: "MEDIUM",
      urgency: "MEDIUM",
      priority: "P3",
      status: "NEW",
      reportedById: responder.id,
      dueAt: pastDue,
      overdue: false,
    },
  });

  const afterDue = () => new Date(pastDue.getTime() + 1000);
  const firstSweep = await sweepOverdueIncidents({ now: afterDue, db: db() });
  expect(firstSweep.flagged).toBe(1);

  const secondSweep = await sweepOverdueIncidents({ now: afterDue, db: db() });
  expect(secondSweep.flagged).toBe(0);
});
