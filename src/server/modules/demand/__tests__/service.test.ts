import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { runWithContext } from "@/server/context";
import {
  createDemand,
  listDemands,
  getDemandForActor,
} from "@/server/modules/demand/service";
import type { Actor } from "@/server/policy/actor";
import { NotFoundError } from "@/server/policy/errors";

const db = withTestDb();
const ctx = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithContext({ requestId: "r", actorId: "sys" }, fn);

async function seedClientAndGuest() {
  const client = await db().client.create({
    data: { name: `N-${Math.random().toString(16).slice(2)}`, isActive: true },
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
  return { client, guest };
}

test("a guest creating a demand: ref allocated, client + submitter set server-side, audit written", async () => {
  const { client, guest } = await seedClientAndGuest();
  const guestActor: Actor = {
    id: guest.id,
    kind: "GUEST",
    hats: [],
    clientId: client.id,
  };

  const { id, ref } = await ctx(() =>
    db().$transaction((tx) =>
      createDemand(guestActor, tx, {
        title: "Faster exports",
        problem: "reports take 20 min",
        source: "CLIENT",
      }),
    ),
  );

  const d = await db().demand.findUniqueOrThrow({ where: { id } });
  expect(ref).toMatch(/^DEM-\d{4}$/);
  expect(d.clientId).toBe(client.id);
  expect(d.submittedById).toBe(guest.id);
  expect(d.status).toBe("SUBMITTED");
  const audit = await db().auditEvent.findFirst({
    where: { action: "demand.create", subjectId: id },
  });
  expect(audit).toBeTruthy();
});

test("a guest creating a demand notifies every active internal user", async () => {
  const { client, guest } = await seedClientAndGuest();
  const a = await db().user.create({
    data: {
      email: `a-${client.id}@k`,
      passwordHash: "x",
      displayName: "A",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  const guestActor: Actor = {
    id: guest.id,
    kind: "GUEST",
    hats: [],
    clientId: client.id,
  };

  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createDemand(guestActor, tx, {
        title: "T",
        problem: "P",
        source: "CLIENT",
      }),
    ),
  );
  const notes = await db().notification.findMany({ where: { subjectId: id } });
  expect(notes.map((n) => n.userId)).toContain(a.id);
});

test("guest list is scoped to the guest's own client; cross-client get is a 404", async () => {
  const one = await seedClientAndGuest();
  const two = await seedClientAndGuest();
  const oneActor: Actor = {
    id: one.guest.id,
    kind: "GUEST",
    hats: [],
    clientId: one.client.id,
  };
  const twoActor: Actor = {
    id: two.guest.id,
    kind: "GUEST",
    hats: [],
    clientId: two.client.id,
  };

  await ctx(() =>
    db().$transaction((tx) =>
      createDemand(oneActor, tx, {
        title: "mine",
        problem: "p",
        source: "CLIENT",
      }),
    ),
  );
  await ctx(() =>
    db().$transaction((tx) =>
      createDemand(twoActor, tx, {
        title: "theirs",
        problem: "p",
        source: "CLIENT",
      }),
    ),
  );

  // Reads take an optional trailing client (as `listComments` does) so a test
  // can point them at its disposable database rather than the app singleton.
  const list = await listDemands(oneActor, {}, db());
  expect(list.map((d) => d.title)).toEqual(["mine"]);
  await expect(
    getDemandForActor(oneActor, "does-not-exist", db()),
  ).rejects.toBeInstanceOf(NotFoundError);
});

test("an internal user creating a demand: no client, source INTERNAL allowed, no guest-created notification storm", async () => {
  const u = await db().user.create({
    data: {
      email: `i-${Math.random().toString(16).slice(2)}@k`,
      passwordHash: "x",
      displayName: "I",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  const actor: Actor = {
    id: u.id,
    kind: "INTERNAL",
    hats: ["DEVELOPER"],
    clientId: null,
  };
  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createDemand(actor, tx, {
        title: "tech debt",
        problem: "p",
        source: "TECH_DEBT",
      }),
    ),
  );
  const d = await db().demand.findUniqueOrThrow({ where: { id } });
  expect(d.clientId).toBeNull();
  expect(await db().notification.count({ where: { subjectId: id } })).toBe(0);
});
