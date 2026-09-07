import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import {
  hrefFor,
  listFailedEmails,
  listNotifications,
  markRead,
  unreadCount,
} from "@/server/modules/notify/read";
import type { Actor } from "@/server/policy/actor";

const db = withTestDb();

async function seedUserWithNotes(kind: "INTERNAL" | "GUEST" = "INTERNAL") {
  const user = await db().user.create({
    data: {
      email: `n-${Math.random().toString(16).slice(2)}@k`,
      passwordHash: "x",
      displayName: "N",
      kind,
      hats: kind === "INTERNAL" ? ["DEVELOPER"] : [],
      clientId: null,
    },
  });
  await db().notification.createMany({
    data: [
      {
        userId: user.id,
        kind: "ASSIGNED",
        subjectType: "Incident",
        subjectId: "i1",
        payload: { summary: "You were assigned INC-1" },
      },
      {
        userId: user.id,
        kind: "COMMENTED",
        subjectType: "Demand",
        subjectId: "d1",
        payload: { summary: "New comment on DEM-1" },
        readAt: new Date(),
      },
      {
        userId: user.id,
        kind: "APPROVAL_NEEDED",
        subjectType: "ApprovalRequest",
        subjectId: "r1",
        payload: { summary: "Approval needed on CHG-1" },
      },
    ],
  });
  return user;
}

test("listNotifications is scoped to the actor and newest-first; unread filter works", async () => {
  const me = await db().user.create({
    data: {
      email: `n-${Math.random().toString(16).slice(2)}@k`,
      passwordHash: "x",
      displayName: "N",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
      clientId: null,
    },
  });
  // Create notifications with explicit distinct createdAt values to test primary sort key
  await db().notification.create({
    data: {
      userId: me.id,
      kind: "ASSIGNED",
      subjectType: "Incident",
      subjectId: "i1",
      payload: { summary: "You were assigned INC-1" },
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  });
  await db().notification.create({
    data: {
      userId: me.id,
      kind: "COMMENTED",
      subjectType: "Demand",
      subjectId: "d1",
      payload: { summary: "New comment on DEM-1" },
      readAt: new Date(),
      createdAt: new Date("2026-01-01T01:00:00Z"),
    },
  });
  await db().notification.create({
    data: {
      userId: me.id,
      kind: "APPROVAL_NEEDED",
      subjectType: "ApprovalRequest",
      subjectId: "r1",
      payload: { summary: "Approval needed on CHG-1" },
      createdAt: new Date("2026-01-01T02:00:00Z"),
    },
  });

  const other = await seedUserWithNotes();
  const actor: Actor = {
    id: me.id,
    kind: "INTERNAL",
    hats: ["DEVELOPER"],
    clientId: null,
  };

  const all = await listNotifications(actor, {}, db());
  expect(all.map((n) => n.subjectId)).toEqual(["r1", "d1", "i1"]); // createdAt desc — d1 has readAt so still listed
  expect(all.every((n) => n.summary.length > 0)).toBe(true);
  expect(all.every((n) => n.href.startsWith("/"))).toBe(true);

  const unread = await listNotifications(actor, { unread: true }, db());
  expect(unread.map((n) => n.subjectId).sort()).toEqual(["i1", "r1"]);

  // never another user's rows
  const otherActor: Actor = {
    id: other.id,
    kind: "INTERNAL",
    hats: ["DEVELOPER"],
    clientId: null,
  };
  const otherList = await listNotifications(otherActor, {}, db());
  expect(
    otherList.every((n) => all.find((a) => a.id === n.id) === undefined),
  ).toBe(true);
});

test("unreadCount counts only the actor's unread rows, with cross-user isolation", async () => {
  const me = await seedUserWithNotes();
  const other = await seedUserWithNotes();
  const actor: Actor = {
    id: me.id,
    kind: "INTERNAL",
    hats: [],
    clientId: null,
  };
  const otherActor: Actor = {
    id: other.id,
    kind: "INTERNAL",
    hats: [],
    clientId: null,
  };
  // User A should have 2 unread, user B should have 2 unread
  expect(await unreadCount(actor, db())).toBe(2);
  expect(await unreadCount(otherActor, db())).toBe(2);
});

test("markRead({ ids }) marks only the actor's matching unread rows; markRead({ all }) clears the rest", async () => {
  const me = await seedUserWithNotes();
  const other = await seedUserWithNotes();
  const actor: Actor = {
    id: me.id,
    kind: "INTERNAL",
    hats: [],
    clientId: null,
  };
  const otherActor: Actor = {
    id: other.id,
    kind: "INTERNAL",
    hats: [],
    clientId: null,
  };

  const mine = await listNotifications(actor, { unread: true }, db());
  // try to mark one of the other user's ids too — must be a no-op for it
  const otherMine = await listNotifications(otherActor, { unread: true }, db());
  const r1 = await markRead(
    actor,
    { ids: [mine[0]!.id, otherMine[0]!.id] },
    db(),
  );
  expect(r1.updated).toBe(1); // only the actor's own

  const r2 = await markRead(actor, { all: true }, db());
  expect(r2.updated).toBe(1);
  expect(await unreadCount(actor, db())).toBe(0);
  expect(await unreadCount(otherActor, db())).toBe(2); // untouched
});

test("listFailedEmails: FAILED rows in the last 7 days, newest first, capped at 10", async () => {
  await db().emailOutbox.deleteMany();

  // 12 FAILED rows inside the 7-day window, updatedAt staggered oldest→newest
  // (i=11 is the most recent).
  for (let i = 0; i < 12; i++) {
    const row = await db().emailOutbox.create({
      data: {
        toEmail: `f${i}@k.example`,
        template: "demand_decided",
        payload: { ref: `DEM-${i}` },
        status: "FAILED",
        attempts: 6,
        lastError: `boom ${i}`,
      },
    });
    await db().$executeRaw`
      UPDATE "EmailOutbox" SET "updatedAt" = ${new Date(
        Date.now() - (20 - i) * 60_000,
      )} WHERE id = ${row.id}`;
  }

  // Excluded: not FAILED.
  await db().emailOutbox.create({
    data: {
      toEmail: "pending@k.example",
      template: "demand_decided",
      payload: {},
      status: "PENDING",
    },
  });
  // Excluded: FAILED but older than 7 days.
  const stale = await db().emailOutbox.create({
    data: {
      toEmail: "stale@k.example",
      template: "demand_decided",
      payload: {},
      status: "FAILED",
      attempts: 6,
      lastError: "ancient",
    },
  });
  await db().$executeRaw`
    UPDATE "EmailOutbox" SET "updatedAt" = ${new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    )} WHERE id = ${stale.id}`;

  const { count, recent } = await listFailedEmails(db());

  expect(count).toBe(12);
  expect(recent).toHaveLength(10);
  // Newest first: f11 down to f2.
  expect(recent.map((r) => r.toEmail)).toEqual([
    "f11@k.example",
    "f10@k.example",
    "f9@k.example",
    "f8@k.example",
    "f7@k.example",
    "f6@k.example",
    "f5@k.example",
    "f4@k.example",
    "f3@k.example",
    "f2@k.example",
  ]);
  expect(recent[0]).toEqual({
    toEmail: "f11@k.example",
    template: "demand_decided",
    lastError: "boom 11",
    attempts: 6,
  });
});

test("hrefFor: internal vs guest deep links, case-insensitive subjectType", () => {
  expect(hrefFor("Incident", "i1", "INTERNAL")).toBe("/incidents?open=i1");
  expect(hrefFor("incident", "i1", "INTERNAL")).toBe("/incidents?open=i1");
  expect(hrefFor("Change", "c1", "INTERNAL")).toBe("/changes?open=c1");
  expect(hrefFor("ApprovalRequest", "r1", "INTERNAL")).toBe("/approvals");
  expect(hrefFor("Demand", "d1", "INTERNAL")).toBe("/demands?open=d1");
  expect(hrefFor("Comment", "x", "INTERNAL")).toBe("/overview");
  expect(hrefFor("Demand", "d1", "GUEST")).toBe("/portal/demands/d1");
  expect(hrefFor("Incident", "i1", "GUEST")).toBe("/portal/incidents/i1");
  expect(hrefFor("Change", "c1", "GUEST")).toBe("/portal"); // a guest never sees a change
});
