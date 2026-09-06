import { expect, test } from "vitest";
import { runWithContext } from "@/server/context";
import {
  createChange,
  createChangeFromDemand,
  getChangeForActor,
  listChanges,
} from "@/server/modules/change/service";
import type { Actor, Hat } from "@/server/policy/actor";
import { ForbiddenError } from "@/server/policy/errors";
import { withTestDb } from "@/test/db";

const db = withTestDb();
const ctx = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithContext({ requestId: "r", actorId: "sys" }, fn);

const rand = () => Math.random().toString(16).slice(2);

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

async function seedGuest(): Promise<Actor> {
  const client = await db().client.create({
    data: { name: `N-${rand()}`, isActive: true },
  });
  const guest = await db().user.create({
    data: {
      email: `g-${rand()}@k`,
      passwordHash: "x",
      displayName: "G",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  return { id: guest.id, kind: "GUEST", hats: [], clientId: client.id };
}

async function seedDemand(submittedById: string): Promise<{ id: string }> {
  return db().demand.create({
    data: {
      ref: `DEM-${rand()}`,
      title: "New reporting capability",
      problem: "clients need exportable reports",
      source: "CLIENT",
      status: "APPROVED",
      submittedById,
    },
  });
}

test("createChange: ref CHG-nnnn, status DRAFT, owner = actor, change.created audited", async () => {
  const dev = await seedInternal(["DEVELOPER"]);

  const { id, ref } = await ctx(() =>
    db().$transaction((tx) =>
      createChange(dev.actor, tx, { title: "Upgrade Node", rfc: "bump to 22" }),
    ),
  );

  expect(ref).toMatch(/^CHG-\d{4}$/);
  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.ownerId).toBe(dev.id);
  expect(row.status).toBe("DRAFT");
  expect(row.changeType).toBe("NORMAL");

  const audit = await db().auditEvent.findMany({
    where: { action: "change.created", subjectId: id },
  });
  expect(audit).toHaveLength(1);
});

test("createChange with originatingDemandId links it and stores the id", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const demand = await seedDemand(dev.id);

  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createChange(dev.actor, tx, {
        title: "Deliver the demand",
        rfc: "plan",
        originatingDemandId: demand.id,
      }),
    ),
  );

  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.originatingDemandId).toBe(demand.id);
});

test("createChangeFromDemand is idempotent: a second call returns the same change, created:false, and writes no second change.created audit", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const demand = await seedDemand(dev.id);

  const first = await ctx(() =>
    db().$transaction((tx) =>
      createChangeFromDemand(tx, { demandId: demand.id, actor: dev.actor }),
    ),
  );
  expect(first.created).toBe(true);
  expect(first.ref).toMatch(/^CHG-\d{4}$/);

  const second = await ctx(() =>
    db().$transaction((tx) =>
      createChangeFromDemand(tx, { demandId: demand.id, actor: dev.actor }),
    ),
  );
  expect(second.id).toBe(first.id);
  expect(second.ref).toBe(first.ref);
  expect(second.created).toBe(false);

  const audit = await db().auditEvent.findMany({
    where: { action: "change.created", subjectId: first.id },
  });
  expect(audit).toHaveLength(1);

  const row = await db().change.findUniqueOrThrow({ where: { id: first.id } });
  expect(row.originatingDemandId).toBe(demand.id);
  expect(row.title).toBe("New reporting capability");
});

test("a guest cannot list or get a change (ForbiddenError)", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const guest = await seedGuest();
  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createChange(dev.actor, tx, { title: "c", rfc: "r" }),
    ),
  );

  await expect(listChanges(guest, {}, db())).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await expect(getChangeForActor(guest, id, db())).rejects.toBeInstanceOf(
    ForbiddenError,
  );
});

test("listChanges ?mine and ?scheduled filters (internal)", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const other = await seedInternal(["DEVELOPER"]);

  const mine = await ctx(() =>
    db().$transaction((tx) =>
      createChange(dev.actor, tx, { title: "mine", rfc: "r" }),
    ),
  );
  const theirs = await ctx(() =>
    db().$transaction((tx) =>
      createChange(other.actor, tx, { title: "theirs", rfc: "r" }),
    ),
  );
  await db().change.update({
    where: { id: theirs.id },
    data: { status: "SCHEDULED" },
  });

  const mineList = await listChanges(dev.actor, { mine: true }, db());
  expect(mineList.map((c) => c.id)).toEqual([mine.id]);

  const scheduledList = await listChanges(dev.actor, { scheduled: true }, db());
  expect(scheduledList.map((c) => c.id)).toEqual([theirs.id]);
});

test("getChangeForActor returns the stepper + gate for the current stage and the serialized approval state", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createChange(dev.actor, tx, { title: "standalone", rfc: "an RFC body" }),
    ),
  );

  const view = await getChangeForActor(dev.actor, id, db());

  expect(view.stage).toBe("draft");
  const stepper = view.stepper as {
    stages: { key: string; gate: { key: string; done: boolean }[] }[];
    currentStageKey: string;
    canAdvance: boolean;
  };
  expect(stepper.stages).toHaveLength(7);
  expect(stepper.currentStageKey).toBe("draft");
  // RFC is present but there is no demand link and no standalone confirmation,
  // so the draft gate cannot advance.
  expect(stepper.canAdvance).toBe(false);

  const approval = view.approval as { status: string | null };
  expect(approval.status).toBeNull();
  expect(Array.isArray(view.activity)).toBe(true);
});
