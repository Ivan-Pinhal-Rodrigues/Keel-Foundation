import { expect, test } from "vitest";
import { runWithContext } from "@/server/context";
import {
  createChange,
  createChangeFromDemand,
  editChange,
  getChangeForActor,
  linkIncident,
  listChanges,
} from "@/server/modules/change/service";
import type { Actor, Hat } from "@/server/policy/actor";
import { ForbiddenError, NotFoundError } from "@/server/policy/errors";
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

async function seedIncident(reportedById: string): Promise<{ id: string }> {
  return db().incident.create({
    data: {
      ref: `INC-${rand()}`,
      title: "Login is down",
      description: "users cannot sign in",
      affectedService: "auth",
      impact: "HIGH",
      urgency: "HIGH",
      priority: "P1",
      status: "NEW",
      reportedById,
      dueAt: new Date("2026-01-01T00:00:00.000Z"),
      overdue: false,
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

test("editChange updates fields and audits change.edited; setting riskLevel also audits change.risk_assessed; setting rollbackPlan also audits change.rollback_plan_set", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createChange(dev.actor, tx, { title: "Upgrade", rfc: "original" }),
    ),
  );

  await ctx(() =>
    db().$transaction((tx) =>
      editChange(dev.actor, tx, id, {
        rfc: "revised RFC body",
        riskLevel: "HIGH",
        impactAssessment: "affects all clients",
        rollbackPlan: "restore the prior release",
      }),
    ),
  );

  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.rfc).toBe("revised RFC body");
  expect(row.riskLevel).toBe("HIGH");
  expect(row.impactAssessment).toBe("affects all clients");
  expect(row.rollbackPlan).toBe("restore the prior release");

  const edited = await db().auditEvent.findMany({
    where: { action: "change.edited", subjectId: id },
  });
  expect(edited).toHaveLength(1);
  const editedRow = await db().auditEvent.findFirstOrThrow({
    where: { action: "change.edited", subjectId: id },
  });
  expect(editedRow.payload).toEqual({
    fields: ["rfc", "riskLevel", "impactAssessment", "rollbackPlan"],
  });

  const riskAssessed = await db().auditEvent.findMany({
    where: { action: "change.risk_assessed", subjectId: id },
  });
  expect(riskAssessed).toHaveLength(1);
  const riskRow = await db().auditEvent.findFirstOrThrow({
    where: { action: "change.risk_assessed", subjectId: id },
  });
  expect(riskRow.payload).toEqual({ riskLevel: "HIGH" });

  const rollback = await db().auditEvent.findMany({
    where: { action: "change.rollback_plan_set", subjectId: id },
  });
  expect(rollback).toHaveLength(1);

  // An edit that touches neither field writes only change.edited.
  await ctx(() =>
    db().$transaction((tx) =>
      editChange(dev.actor, tx, id, { rfc: "another pass" }),
    ),
  );
  expect(
    await db().auditEvent.count({
      where: { action: "change.edited", subjectId: id },
    }),
  ).toBe(2);
  expect(
    await db().auditEvent.count({
      where: { action: "change.risk_assessed", subjectId: id },
    }),
  ).toBe(1);
});

test("editChange by a non-owner non-DEVELOPER → ForbiddenError", async () => {
  const owner = await seedInternal(["DEVELOPER"]);
  const other = await seedInternal([]);
  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createChange(owner.actor, tx, { title: "c", rfc: "r" }),
    ),
  );

  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        editChange(other.actor, tx, id, { rfc: "sneaky" }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("editChange is rejected once the change is IMPLEMENTING+", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createChange(dev.actor, tx, { title: "c", rfc: "r" }),
    ),
  );
  await db().change.update({
    where: { id },
    data: { status: "IMPLEMENTING" },
  });

  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        editChange(dev.actor, tx, id, { rfc: "too late" }),
      ),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("linkIncident CAUSED_BY / FIXES creates the join row, audits change.incident_linked, and is idempotent on a repeat", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createChange(dev.actor, tx, { title: "c", rfc: "r" }),
    ),
  );
  const incident = await seedIncident(dev.id);

  await ctx(() =>
    db().$transaction((tx) =>
      linkIncident(dev.actor, tx, id, {
        incidentId: incident.id,
        kind: "CAUSED_BY",
      }),
    ),
  );
  await ctx(() =>
    db().$transaction((tx) =>
      linkIncident(dev.actor, tx, id, {
        incidentId: incident.id,
        kind: "FIXES",
      }),
    ),
  );

  const links = await db().changeIncidentLink.findMany({
    where: { changeId: id },
    orderBy: { kind: "asc" },
  });
  expect(links.map((l) => l.kind)).toEqual(["CAUSED_BY", "FIXES"]);

  const audits = await db().auditEvent.findMany({
    where: { action: "change.incident_linked", subjectId: id },
  });
  expect(audits).toHaveLength(2);

  // A repeat of an existing link is a no-op: no new row, no new audit.
  await ctx(() =>
    db().$transaction((tx) =>
      linkIncident(dev.actor, tx, id, {
        incidentId: incident.id,
        kind: "CAUSED_BY",
      }),
    ),
  );
  expect(await db().changeIncidentLink.count({ where: { changeId: id } })).toBe(
    2,
  );
  expect(
    await db().auditEvent.count({
      where: { action: "change.incident_linked", subjectId: id },
    }),
  ).toBe(2);
});

test("linkIncident with an unknown incidentId → NotFoundError", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const { id } = await ctx(() =>
    db().$transaction((tx) =>
      createChange(dev.actor, tx, { title: "c", rfc: "r" }),
    ),
  );

  await expect(
    ctx(() =>
      db().$transaction((tx) =>
        linkIncident(dev.actor, tx, id, {
          incidentId: "does-not-exist",
          kind: "FIXES",
        }),
      ),
    ),
  ).rejects.toBeInstanceOf(NotFoundError);
});
