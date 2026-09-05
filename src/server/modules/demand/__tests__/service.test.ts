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
  decideDemand,
  rejectDemand,
} from "@/server/modules/demand/service";
import type { Actor, Hat } from "@/server/policy/actor";
import {
  ForbiddenError,
  NotFoundError,
  SegregationError,
} from "@/server/policy/errors";

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

  // a TECHNICAL_APPROVER without the BUSINESS_APPROVER hat is also rejected
  // (the mirror of the scoreEffort check below).
  const techOnly = (await seedInternal(["TECHNICAL_APPROVER"])).actor;
  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        scoreValue(techOnly, tx, id, { businessValue: "high" }),
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

// --- Task 4: worth decision, reject, single-approver override -------------

async function seedAssessedDemand(opts?: {
  /** An internal user who is also the submitter (the SoD case). Default: a
   *  fresh guest submits, so the demand carries a clientId. */
  internalSubmitterId?: string;
  status?: "WORTH_ASSESSED" | "APPROVED";
  decision?: "PURSUE" | "PARK" | null;
}): Promise<{
  id: string;
  guestActor: Actor;
  submitterId: string;
  guestEmail: string;
}> {
  const { client, guest } = await seedClientAndGuest();
  const submitterId = opts?.internalSubmitterId ?? guest.id;
  const guestRow = await db().user.findUniqueOrThrow({
    where: { id: guest.id },
  });
  const demand = await db().demand.create({
    data: {
      ref: `DEM-${rand()}`,
      title: "T",
      problem: "P",
      source: "CLIENT",
      status: opts?.status ?? "WORTH_ASSESSED",
      submittedById: submitterId,
      clientId: opts?.internalSubmitterId ? null : client.id,
    },
  });
  await db().worthAssessment.create({
    data: {
      demandId: demand.id,
      businessValue: "high",
      valueScore: 8,
      effort: "M",
      costOfDelay: "compounding",
      decision: opts?.decision ?? null,
    },
  });
  return {
    id: demand.id,
    guestActor: { id: guest.id, kind: "GUEST", hats: [], clientId: client.id },
    submitterId,
    guestEmail: guestRow.email,
  };
}

test("a non-submitter approver decides: WORTH_ASSESSED → APPROVED, decision + note recorded, demand.decided audited, submitter notified + emailed", async () => {
  const { id, submitterId, guestEmail } = await seedAssessedDemand();
  const biz = (await seedInternal(["BUSINESS_APPROVER"])).actor;

  await ctx(() =>
    db().$transaction((tx) =>
      decideDemand(biz, tx, id, { decision: "PURSUE", note: "clear ROI" }),
    ),
  );

  const d = await db().demand.findUniqueOrThrow({ where: { id } });
  expect(d.status).toBe("APPROVED");
  expect(d.decidedAt).not.toBeNull();
  const w = await db().worthAssessment.findUniqueOrThrow({
    where: { demandId: id },
  });
  expect(w.decision).toBe("PURSUE");
  expect(w.decisionNote).toBe("clear ROI");
  expect(w.decidedById).toBe(biz.id);
  expect(w.isSingleApproverOverride).toBe(false);

  expect(
    await db().auditEvent.findMany({
      where: { subjectId: id, action: "demand.decided" },
    }),
  ).toHaveLength(1);

  const notes = await db().notification.findMany({ where: { subjectId: id } });
  expect(notes.map((n) => n.userId)).toContain(submitterId);
  const outbox = await db().emailOutbox.findMany({
    where: { toEmail: guestEmail, template: "demand_decided" },
  });
  expect(outbox).toHaveLength(1);
});

test("the submitter deciding their own demand → SegregationError('demand.decide.override')", async () => {
  const submitter = await seedInternal(["BUSINESS_APPROVER"]);
  const { id } = await seedAssessedDemand({
    internalSubmitterId: submitter.id,
  });

  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        decideDemand(submitter.actor, tx, id, { decision: "PURSUE" }),
      ),
    ),
  ).rejects.toBeInstanceOf(SegregationError);
  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        decideDemand(submitter.actor, tx, id, {
          decision: "PURSUE",
          overrideJustification: "too short",
        }),
      ),
    ),
  ).rejects.toMatchObject({ overrideAction: "demand.decide.override" });
});

test("the submitter with a >=20-char justification: recorded as an override, BOTH demand.decided and demand.decide.override audited", async () => {
  const submitter = await seedInternal(["BUSINESS_APPROVER"]);
  const { id } = await seedAssessedDemand({
    internalSubmitterId: submitter.id,
  });

  await ctx(() =>
    db().$transaction((tx) =>
      decideDemand(submitter.actor, tx, id, {
        decision: "PARK",
        overrideJustification:
          "sole approver available this week; CTO on leave",
      }),
    ),
  );

  const w = await db().worthAssessment.findUniqueOrThrow({
    where: { demandId: id },
  });
  expect(w.isSingleApproverOverride).toBe(true);
  expect(w.decision).toBe("PARK");
  expect(w.overrideJustification).toBe(
    "sole approver available this week; CTO on leave",
  );
  const actions = (
    await db().auditEvent.findMany({ where: { subjectId: id } })
  ).map((a) => a.action);
  expect(actions).toEqual(
    expect.arrayContaining(["demand.decided", "demand.decide.override"]),
  );
});

test("DROP records the note as the rejection reason and lands REJECTED; explicit reject → REJECTED with the reason, demand.rejected audited, submitter notified", async () => {
  const biz = (await seedInternal(["BUSINESS_APPROVER"])).actor;

  const dropped = await seedAssessedDemand();
  await ctx(() =>
    db().$transaction((tx) =>
      decideDemand(biz, tx, dropped.id, {
        decision: "DROP",
        note: "out of scope",
      }),
    ),
  );
  let d = await db().demand.findUniqueOrThrow({ where: { id: dropped.id } });
  expect(d.status).toBe("REJECTED");
  expect(d.rejectionReason).toBe("out of scope");

  const rejected = await seedAssessedDemand();
  await ctx(() =>
    db().$transaction((tx) =>
      rejectDemand(biz, tx, rejected.id, { reason: "duplicate request" }),
    ),
  );
  d = await db().demand.findUniqueOrThrow({ where: { id: rejected.id } });
  expect(d.status).toBe("REJECTED");
  expect(d.rejectionReason).toBe("duplicate request");
  const w = await db().worthAssessment.findUniqueOrThrow({
    where: { demandId: rejected.id },
  });
  expect(w.decision).toBe("DROP");
  expect(
    await db().auditEvent.findFirst({
      where: { subjectId: rejected.id, action: "demand.rejected" },
    }),
  ).toBeTruthy();
  const notes = await db().notification.findMany({
    where: { subjectId: rejected.id },
  });
  expect(notes.map((n) => n.userId)).toContain(rejected.submitterId);
});

test("park then re-decide: APPROVED(PARK) → decideDemand(PURSUE) → APPROVED(PURSUE), one more demand.decided audit", async () => {
  const { id } = await seedAssessedDemand({
    status: "APPROVED",
    decision: "PARK",
  });
  const biz = (await seedInternal(["BUSINESS_APPROVER"])).actor;

  await ctx(() =>
    db().$transaction((tx) =>
      decideDemand(biz, tx, id, { decision: "PURSUE" }),
    ),
  );

  const d = await db().demand.findUniqueOrThrow({ where: { id } });
  expect(d.status).toBe("APPROVED");
  const w = await db().worthAssessment.findUniqueOrThrow({
    where: { demandId: id },
  });
  expect(w.decision).toBe("PURSUE");
  expect(
    await db().auditEvent.findMany({
      where: { subjectId: id, action: "demand.decided" },
    }),
  ).toHaveLength(1);
});

test("a guest cannot decide or reject", async () => {
  const { id, guestActor } = await seedAssessedDemand();
  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        decideDemand(guestActor, tx, id, { decision: "PURSUE" }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        rejectDemand(guestActor, tx, id, { reason: "no" }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("decide / reject on a demand that is not awaiting a decision → ForbiddenError", async () => {
  const biz = (await seedInternal(["BUSINESS_APPROVER"])).actor;
  const { id } = await seedDemand("TRIAGING", { businessValue: "v" });
  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        decideDemand(biz, tx, id, { decision: "PURSUE" }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);
});
