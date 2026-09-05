import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { runWithContext } from "@/server/context";
import {
  createDemand,
  listDemands,
  getDemandForActor,
  startTriage,
  scoreValue,
  scoreEffort,
  setCostOfDelay,
} from "@/server/modules/demand/service";
import type { Actor, Hat } from "@/server/policy/actor";
import { ForbiddenError, NotFoundError } from "@/server/policy/errors";

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

// --- Task 3: state machine + triage & scoring -----------------------------

const rand = () => Math.random().toString(16).slice(2);

async function seedInternal(
  hats: Hat[],
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

async function seedDemand(
  status: "SUBMITTED" | "TRIAGING",
  worth?: {
    businessValue?: string;
    effort?: "S" | "M" | "L";
    costOfDelay?: string;
  },
): Promise<{ id: string; guestActor: Actor }> {
  const { client, guest } = await seedClientAndGuest();
  const demand = await db().demand.create({
    data: {
      ref: `DEM-${rand()}`,
      title: "T",
      problem: "P",
      source: "CLIENT",
      status,
      submittedById: guest.id,
      clientId: client.id,
    },
  });
  if (worth) {
    await db().worthAssessment.create({
      data: {
        demandId: demand.id,
        businessValue: worth.businessValue ?? null,
        effort: worth.effort ?? null,
        costOfDelay: worth.costOfDelay ?? null,
      },
    });
  }
  return {
    id: demand.id,
    guestActor: { id: guest.id, kind: "GUEST", hats: [], clientId: client.id },
  };
}

test("startTriage moves SUBMITTED → TRIAGING and creates an empty WorthAssessment", async () => {
  const { id } = await seedDemand("SUBMITTED");
  const { actor } = await seedInternal(["DEVELOPER"]);

  await ctx(() => db().$transaction((tx) => startTriage(actor, tx, id)));

  const d = await db().demand.findUniqueOrThrow({ where: { id } });
  expect(d.status).toBe("TRIAGING");
  expect(
    await db().worthAssessment.findUnique({ where: { demandId: id } }),
  ).toBeTruthy();
  expect(
    await db().auditEvent.findFirst({
      where: { action: "demand.triage_started", subjectId: id },
    }),
  ).toBeTruthy();
});

test("startTriage on a missing demand is a NotFoundError; a guest cannot triage", async () => {
  const { id, guestActor } = await seedDemand("SUBMITTED");
  await expect(
    ctx(() => db().$transaction((tx) => startTriage(guestActor, tx, id))),
  ).rejects.toBeInstanceOf(ForbiddenError);
  const { actor } = await seedInternal(["DEVELOPER"]);
  await expect(
    ctx(() => db().$transaction((tx) => startTriage(actor, tx, "nope"))),
  ).rejects.toBeInstanceOf(NotFoundError);
});

test("only a BUSINESS_APPROVER may score value; only a TECHNICAL_APPROVER may score effort", async () => {
  const { id } = await seedDemand("TRIAGING", {});
  const dev = (await seedInternal(["DEVELOPER"])).actor;
  const biz = (await seedInternal(["BUSINESS_APPROVER"])).actor;

  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        scoreValue(dev, tx, id, { businessValue: "high" }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);

  await ctx(() =>
    db().$transaction((tx) =>
      scoreValue(biz, tx, id, { businessValue: "high", valueScore: 8 }),
    ),
  );
  const w = await db().worthAssessment.findUniqueOrThrow({
    where: { demandId: id },
  });
  expect(w.businessValue).toBe("high");
  expect(w.valueScore).toBe(8);
  expect(w.valueScoredById).toBe(biz.id);

  // the CEO holds BUSINESS_APPROVER but not TECHNICAL_APPROVER
  await expect(
    ctx(() =>
      db().$transaction((tx) => scoreEffort(biz, tx, id, { effort: "M" })),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("scoring the last of {value, effort, costOfDelay} flips the demand to WORTH_ASSESSED", async () => {
  const { id } = await seedDemand("TRIAGING", {
    businessValue: "high",
    costOfDelay: "grows fast",
  });
  const tech = (await seedInternal(["TECHNICAL_APPROVER"])).actor;

  await ctx(() =>
    db().$transaction((tx) =>
      scoreEffort(tech, tx, id, { effort: "M", feasibility: "doable" }),
    ),
  );

  const d = await db().demand.findUniqueOrThrow({ where: { id } });
  expect(d.status).toBe("WORTH_ASSESSED");
  expect(
    await db().auditEvent.findFirst({
      where: { action: "demand.effort_scored", subjectId: id },
    }),
  ).toBeTruthy();
  // the implicit transition writes no audit event (spec §6 has no such event)
  expect(
    await db().auditEvent.findFirst({
      where: { action: "demand.worth_assessed", subjectId: id },
    }),
  ).toBeNull();
});

test("setCostOfDelay: any internal user sets it, audited, and it can complete the worth gate", async () => {
  const { id } = await seedDemand("TRIAGING", {
    businessValue: "high",
    effort: "M",
  });
  const dev = (await seedInternal(["DEVELOPER"])).actor;

  await ctx(() =>
    db().$transaction((tx) =>
      setCostOfDelay(dev, tx, id, { costOfDelay: "compounding" }),
    ),
  );

  const d = await db().demand.findUniqueOrThrow({ where: { id } });
  expect(d.status).toBe("WORTH_ASSESSED");
  expect(
    await db().auditEvent.findFirst({
      where: { action: "demand.cost_of_delay_set", subjectId: id },
    }),
  ).toBeTruthy();
});

test("value scored notifies TECHNICAL_APPROVER hat holders; effort scored notifies BUSINESS_APPROVER hat holders", async () => {
  const { id } = await seedDemand("TRIAGING", {});
  const biz = (await seedInternal(["BUSINESS_APPROVER"])).actor;
  const tech = (await seedInternal(["TECHNICAL_APPROVER"])).actor;

  await ctx(() =>
    db().$transaction((tx) => scoreValue(biz, tx, id, { businessValue: "v" })),
  );
  let notes = await db().notification.findMany({ where: { subjectId: id } });
  expect(notes.map((n) => n.userId)).toContain(tech.id);
  expect(notes.map((n) => n.userId)).not.toContain(biz.id);

  await ctx(() =>
    db().$transaction((tx) => scoreEffort(tech, tx, id, { effort: "S" })),
  );
  notes = await db().notification.findMany({ where: { subjectId: id } });
  expect(notes.map((n) => n.userId)).toContain(biz.id);
});
