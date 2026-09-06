import { expect, test } from "vitest";
import { runWithContext } from "@/server/context";
import {
  createDemand,
  decideDemand,
  scoreEffort,
  scoreValue,
  setCostOfDelay,
  startTriage,
} from "@/server/modules/demand/service";
import {
  DEMAND_GUEST_KEYS,
  guestStatusLabel,
  serializeDemand,
} from "@/server/modules/demand/serialize";
import type { Actor } from "@/server/policy/actor";
import { SegregationError } from "@/server/policy/errors";
import { withTestDb } from "@/test/db";

/**
 * Spec 01 §10 — the full demand lifecycle end to end, at the service layer, on a
 * real disposable database. Not a unit test of any one function (those live in
 * `service.test.ts`) — a regression anchor that the pieces Tasks 1–9 built
 * compose: intake → triage → scoring → worth gate → decision, audited at every
 * step, with the guest only ever seeing plain words.
 */

const db = withTestDb();
const ctx = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithContext({ requestId: "r", actorId: "sys" }, fn);
const rand = () => Math.random().toString(16).slice(2);

const DEMAND_INCLUDE = {
  worth: true,
  client: { select: { name: true } },
} as const;

test("a guest demand goes intake → triage → scored → decided, audited at every step, guest sees plain words throughout", async () => {
  // --- 4 distinct users: a client, its guest, a CEO, a CTO ------------------
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
  const ceo = await db().user.create({
    data: {
      email: `ceo-${rand()}@keel.local`,
      passwordHash: "x",
      displayName: "CEO",
      kind: "INTERNAL",
      hats: ["BUSINESS_APPROVER"],
    },
  });
  const cto = await db().user.create({
    data: {
      email: `cto-${rand()}@keel.local`,
      passwordHash: "x",
      displayName: "CTO",
      kind: "INTERNAL",
      hats: ["TECHNICAL_APPROVER"],
    },
  });

  const guestActor: Actor = {
    id: guest.id,
    kind: "GUEST",
    hats: [],
    clientId: client.id,
  };
  const ceoActor: Actor = {
    id: ceo.id,
    kind: "INTERNAL",
    hats: ["BUSINESS_APPROVER"],
    clientId: null,
  };
  const ctoActor: Actor = {
    id: cto.id,
    kind: "INTERNAL",
    hats: ["TECHNICAL_APPROVER"],
    clientId: null,
  };

  // --- 1. guest submits → SUBMITTED, "In review", ALL_INTERNAL notified ----
  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createDemand(guestActor, tx, {
        title: "Faster exports",
        problem: "the monthly report takes 20 minutes",
        source: "CLIENT",
      }),
    ),
  );

  const submittedRow = await db().demand.findUniqueOrThrow({
    where: { id },
    include: DEMAND_INCLUDE,
  });
  expect(submittedRow.status).toBe("SUBMITTED");
  expect(serializeDemand(guestActor, submittedRow).status).toBe("In review");

  const createNotes = await db().notification.findMany({
    where: { subjectId: id },
  });
  expect(createNotes.map((n) => n.userId).sort()).toEqual(
    [ceo.id, cto.id].sort(),
  );
  expect(createNotes.map((n) => n.userId)).not.toContain(guest.id);

  // --- 2. CEO starts triage → TRIAGING ------------------------------------
  await ctx(() => db().$transaction((tx) => startTriage(ceoActor, tx, id)));
  expect((await db().demand.findUniqueOrThrow({ where: { id } })).status).toBe(
    "TRIAGING",
  );

  // --- 3. score value, effort, cost of delay — flips only on the last -----
  await ctx(() =>
    db().$transaction((tx) =>
      scoreValue(ceoActor, tx, id, { businessValue: "high", valueScore: 8 }),
    ),
  );
  expect((await db().demand.findUniqueOrThrow({ where: { id } })).status).toBe(
    "TRIAGING",
  );

  await ctx(() =>
    db().$transaction((tx) => scoreEffort(ctoActor, tx, id, { effort: "S" })),
  );
  expect((await db().demand.findUniqueOrThrow({ where: { id } })).status).toBe(
    "TRIAGING",
  );

  await ctx(() =>
    db().$transaction((tx) =>
      setCostOfDelay(ceoActor, tx, id, { costOfDelay: "compounding" }),
    ),
  );
  expect((await db().demand.findUniqueOrThrow({ where: { id } })).status).toBe(
    "WORTH_ASSESSED",
  );

  // --- 4. CTO (not the submitter) decides PURSUE → APPROVED ---------------
  await ctx(() =>
    db().$transaction((tx) =>
      decideDemand(ctoActor, tx, id, { decision: "PURSUE" }),
    ),
  );

  const finalRow = await db().demand.findUniqueOrThrow({
    where: { id },
    include: DEMAND_INCLUDE,
  });
  expect(finalRow.status).toBe("APPROVED");
  expect(finalRow.worth?.decision).toBe("PURSUE");
  expect(finalRow.decidedAt).not.toBeNull();

  const submitterNotes = await db().notification.findMany({
    where: { subjectId: id, userId: guest.id },
  });
  expect(submitterNotes.some((n) => n.kind === "STATUS_CHANGED")).toBe(true);
  const outbox = await db().emailOutbox.findMany({
    where: { toEmail: guest.email, template: "demand_decided" },
  });
  expect(outbox).toHaveLength(1);

  // --- the audit trail, in order ----------------------------------------
  const actions = (
    await db().auditEvent.findMany({
      where: { subjectId: id },
      orderBy: { at: "asc" },
      select: { action: true },
    })
  ).map((a) => a.action);
  expect(actions).toEqual([
    "demand.create",
    "demand.triage_started",
    "demand.value_scored",
    "demand.effort_scored",
    "demand.cost_of_delay_set",
    "demand.decided",
  ]);

  // --- the guest view: exactly the allowlist + status + clientName -------
  expect(Object.keys(serializeDemand(guestActor, finalRow)).sort()).toEqual(
    [...DEMAND_GUEST_KEYS, "status", "clientName"].sort(),
  );
  expect(serializeDemand(guestActor, finalRow).status).toBe("Approved");
  expect(guestStatusLabel("APPROVED", "PURSUE", null)).toBe("Approved");
});

test("SoD: the CEO both submits and (as sole approver) decides — override required, justified, both audit events", async () => {
  const ceo = await db().user.create({
    data: {
      email: `ceo-sod-${rand()}@keel.local`,
      passwordHash: "x",
      displayName: "CEO",
      kind: "INTERNAL",
      hats: ["BUSINESS_APPROVER", "TECHNICAL_APPROVER"],
    },
  });
  const ceoActor: Actor = {
    id: ceo.id,
    kind: "INTERNAL",
    hats: ["BUSINESS_APPROVER", "TECHNICAL_APPROVER"],
    clientId: null,
  };

  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createDemand(ceoActor, tx, {
        title: "Internal tooling",
        problem: "manual toil in the release process",
        source: "INTERNAL",
      }),
    ),
  );

  await ctx(() => db().$transaction((tx) => startTriage(ceoActor, tx, id)));
  await ctx(() =>
    db().$transaction((tx) =>
      scoreValue(ceoActor, tx, id, { businessValue: "high", valueScore: 7 }),
    ),
  );
  await ctx(() =>
    db().$transaction((tx) => scoreEffort(ceoActor, tx, id, { effort: "M" })),
  );
  await ctx(() =>
    db().$transaction((tx) =>
      setCostOfDelay(ceoActor, tx, id, { costOfDelay: "compounding" }),
    ),
  );
  expect((await db().demand.findUniqueOrThrow({ where: { id } })).status).toBe(
    "WORTH_ASSESSED",
  );

  // no justification → SegregationError with the override action
  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        decideDemand(ceoActor, tx, id, { decision: "PURSUE" }),
      ),
    ),
  ).rejects.toBeInstanceOf(SegregationError);
  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        decideDemand(ceoActor, tx, id, { decision: "PURSUE" }),
      ),
    ),
  ).rejects.toMatchObject({ overrideAction: "demand.decide.override" });

  // a >= 20-char justification → succeeds, flagged as a single-approver override
  const justification =
    "sole approver on duty; co-founder travelling this week";
  await ctx(() =>
    db().$transaction((tx) =>
      decideDemand(ceoActor, tx, id, {
        decision: "PURSUE",
        overrideJustification: justification,
      }),
    ),
  );

  const w = await db().worthAssessment.findUniqueOrThrow({
    where: { demandId: id },
  });
  expect(w.isSingleApproverOverride).toBe(true);
  expect(w.overrideJustification).toBe(justification);

  const actions = (
    await db().auditEvent.findMany({
      where: { subjectId: id },
      select: { action: true },
    })
  ).map((a) => a.action);
  expect(actions).toEqual(
    expect.arrayContaining(["demand.decided", "demand.decide.override"]),
  );
});
