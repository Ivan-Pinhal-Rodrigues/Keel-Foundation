import type { Prisma } from "@prisma/client";
import { expect, test } from "vitest";
import { runWithContext } from "@/server/context";
import type { PrismaTransaction } from "@/server/db/tx";
import {
  advanceChange,
  createChange,
  createChangeFromDemand,
  editChange,
  getChangeForActor,
  linkIncident,
  listChanges,
  recordPir,
  rollbackChange,
  scheduleChange,
} from "@/server/modules/change/service";
import type { Actor, Hat } from "@/server/policy/actor";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/server/policy/errors";
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

// --- Task 7: advance / schedule / rollback / PIR ------------------------------

const tx = <T>(fn: (t: PrismaTransaction) => Promise<T>): Promise<T> =>
  ctx(() => db().$transaction((t) => fn(t as PrismaTransaction)));

async function seedChangeAt(
  ownerActor: Actor,
  patch: Prisma.ChangeUncheckedUpdateInput,
): Promise<string> {
  const { id } = await tx((t) =>
    createChange(ownerActor, t, { title: "c", rfc: "an RFC body" }),
  );
  await db().change.update({ where: { id }, data: patch });
  return id;
}

async function seedApproval(
  changeId: string,
  createdById: string,
  status: "PENDING" | "APPROVED" | "REJECTED",
): Promise<void> {
  await db().approvalRequest.create({
    data: {
      subjectType: "change",
      subjectId: changeId,
      policyKey: "change.standard",
      createdById,
      status,
      resolvedAt: status === "PENDING" ? null : new Date(),
    },
  });
}

test("advanceChange DRAFT→ASSESSING requires RFC + a demand link or standalone ack", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const id = await seedChangeAt(dev.actor, { status: "DRAFT" });

  await expect(
    tx((t) => advanceChange(dev.actor, t, id, { from: "DRAFT" })),
  ).rejects.toBeInstanceOf(ForbiddenError);

  await tx((t) =>
    advanceChange(dev.actor, t, id, {
      from: "DRAFT",
      acknowledgements: { standaloneConfirmed: true },
    }),
  );

  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.status).toBe("ASSESSING");
  const audit = await db().auditEvent.findFirstOrThrow({
    where: { action: "change.advanced", subjectId: id },
  });
  expect(audit.payload).toMatchObject({ from: "DRAFT", to: "ASSESSING" });
});

test("advanceChange ASSESSING→APPROVAL is blocked without a rollback plan", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const id = await seedChangeAt(dev.actor, {
    status: "ASSESSING",
    riskLevel: "LOW",
    impactAssessment: "minimal",
  });

  await expect(
    tx((t) => advanceChange(dev.actor, t, id, { from: "ASSESSING" })),
  ).rejects.toBeInstanceOf(ForbiddenError);

  await db().change.update({
    where: { id },
    data: { rollbackPlan: "revert the release" },
  });
  await tx((t) => advanceChange(dev.actor, t, id, { from: "ASSESSING" }));
  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.status).toBe("APPROVAL");
});

test("advanceChange APPROVAL→SCHEDULED blocked while the approval request is PENDING; allowed once APPROVED", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const id = await seedChangeAt(dev.actor, {
    status: "APPROVAL",
    riskLevel: "LOW",
    impactAssessment: "minimal",
    rollbackPlan: "revert",
  });
  await seedApproval(id, dev.id, "PENDING");

  await expect(
    tx((t) => advanceChange(dev.actor, t, id, { from: "APPROVAL" })),
  ).rejects.toBeInstanceOf(ForbiddenError);

  await db().approvalRequest.updateMany({
    where: { subjectId: id },
    data: { status: "APPROVED", resolvedAt: new Date() },
  });
  await tx((t) => advanceChange(dev.actor, t, id, { from: "APPROVAL" }));
  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.status).toBe("SCHEDULED");
});

test("an EMERGENCY change can advance APPROVAL→SCHEDULED with a still-PENDING request", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const id = await seedChangeAt(dev.actor, {
    status: "APPROVAL",
    changeType: "EMERGENCY",
    riskLevel: "HIGH",
    impactAssessment: "urgent",
    rollbackPlan: "revert",
  });
  await seedApproval(id, dev.id, "PENDING");

  await tx((t) => advanceChange(dev.actor, t, id, { from: "APPROVAL" }));
  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.status).toBe("SCHEDULED");
});

test("advanceChange with a stale `from` → ConflictError", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const id = await seedChangeAt(dev.actor, { status: "DRAFT" });

  await expect(
    tx((t) => advanceChange(dev.actor, t, id, { from: "ASSESSING" })),
  ).rejects.toBeInstanceOf(ConflictError);
});

test("scheduleChange rejects a past window and an end-before-start window; a valid future window audits change.scheduled", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const id = await seedChangeAt(dev.actor, {
    status: "SCHEDULED",
    rollbackPlan: "revert",
  });
  const day = 86_400_000;

  await expect(
    tx((t) =>
      scheduleChange(dev.actor, t, id, {
        windowStart: new Date(Date.now() - 2 * day),
        windowEnd: new Date(Date.now() - day),
      }),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);

  await expect(
    tx((t) =>
      scheduleChange(dev.actor, t, id, {
        windowStart: new Date(Date.now() + 2 * day),
        windowEnd: new Date(Date.now() + day),
      }),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);

  const windowStart = new Date(Date.now() + day);
  const windowEnd = new Date(Date.now() + 2 * day);
  await tx((t) => scheduleChange(dev.actor, t, id, { windowStart, windowEnd }));

  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.windowStart?.getTime()).toBe(windowStart.getTime());
  const audit = await db().auditEvent.findMany({
    where: { action: "change.scheduled", subjectId: id },
  });
  expect(audit).toHaveLength(1);
});

test("scheduleChange on an APPROVAL-status NORMAL change with a PENDING request → ForbiddenError; the change stays APPROVAL and no change.advanced is written", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const id = await seedChangeAt(dev.actor, {
    status: "APPROVAL",
    rollbackPlan: "revert",
  });
  await seedApproval(id, dev.id, "PENDING");
  const day = 86_400_000;

  await expect(
    tx((t) =>
      scheduleChange(dev.actor, t, id, {
        windowStart: new Date(Date.now() + day),
        windowEnd: new Date(Date.now() + 2 * day),
      }),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);

  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.status).toBe("APPROVAL");
  const advanced = await db().auditEvent.findMany({
    where: { action: "change.advanced", subjectId: id },
  });
  expect(advanced).toHaveLength(0);
});

test("scheduleChange on an APPROVAL-status change with an APPROVED request enters SCHEDULED: change.scheduled + change.advanced audits, and exactly one scheduled notification to the other internal user", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const other = await seedInternal(["DEVELOPER"]);
  const id = await seedChangeAt(dev.actor, {
    status: "APPROVAL",
    rollbackPlan: "revert",
  });
  await seedApproval(id, dev.id, "APPROVED");
  const day = 86_400_000;
  const windowStart = new Date(Date.now() + day);
  const windowEnd = new Date(Date.now() + 2 * day);

  await tx((t) => scheduleChange(dev.actor, t, id, { windowStart, windowEnd }));

  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.status).toBe("SCHEDULED");

  const scheduled = await db().auditEvent.findMany({
    where: { action: "change.scheduled", subjectId: id },
  });
  expect(scheduled).toHaveLength(1);
  const advanced = await db().auditEvent.findMany({
    where: { action: "change.advanced", subjectId: id },
  });
  expect(advanced).toHaveLength(1);
  const advancedRow = await db().auditEvent.findFirstOrThrow({
    where: { action: "change.advanced", subjectId: id },
  });
  expect(advancedRow.payload).toMatchObject({
    from: "APPROVAL",
    to: "SCHEDULED",
  });

  // ALL_INTERNAL resolves every internal user in the per-file db, so scope the
  // assertions to this change and the two users the test seeded.
  const toOther = await db().notification.findMany({
    where: { subjectId: id, kind: "STATUS_CHANGED", userId: other.id },
  });
  expect(toOther).toHaveLength(1);
  const toOtherRow = await db().notification.findFirstOrThrow({
    where: { subjectId: id, kind: "STATUS_CHANGED", userId: other.id },
  });
  expect((toOtherRow.payload as { summary: string }).summary).toBe(
    `${row.ref} moved to Scheduled`,
  );
  const toActor = await db().notification.findMany({
    where: { subjectId: id, kind: "STATUS_CHANGED", userId: dev.id },
  });
  expect(toActor).toHaveLength(0);
});

test("scheduleChange on an APPROVAL-status EMERGENCY change with a still-PENDING request enters SCHEDULED", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const id = await seedChangeAt(dev.actor, {
    status: "APPROVAL",
    changeType: "EMERGENCY",
    rollbackPlan: "revert",
  });
  await seedApproval(id, dev.id, "PENDING");
  const day = 86_400_000;

  await tx((t) =>
    scheduleChange(dev.actor, t, id, {
      windowStart: new Date(Date.now() + day),
      windowEnd: new Date(Date.now() + 2 * day),
    }),
  );

  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.status).toBe("SCHEDULED");
});

test("rollbackChange from IMPLEMENTING → ROLLED_BACK, change.rolled_back audited, all internal users notified; a terminal change rejects further transitions", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const other = await seedInternal(["DEVELOPER"]);
  const id = await seedChangeAt(dev.actor, {
    status: "IMPLEMENTING",
    rollbackPlan: "revert",
  });

  await tx((t) =>
    rollbackChange(dev.actor, t, id, { note: "  the deploy failed  " }),
  );

  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.status).toBe("ROLLED_BACK");
  expect(row.closedAt).not.toBeNull();
  const audit = await db().auditEvent.findFirstOrThrow({
    where: { action: "change.rolled_back", subjectId: id },
  });
  expect(audit.payload).toEqual({ note: "the deploy failed" });

  const notes = await db().notification.findMany({
    where: { subjectId: id, kind: "STATUS_CHANGED" },
  });
  expect(notes.map((n) => n.userId)).toContain(other.id);
  expect(notes.map((n) => n.userId)).not.toContain(dev.id);

  await expect(
    tx((t) => advanceChange(dev.actor, t, id, { from: "ROLLED_BACK" })),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("recordPir creates the PIR row (once), audits change.pir_recorded; a second recordPir → ConflictError", async () => {
  const approver = await seedInternal(["BUSINESS_APPROVER"]);
  const dev = await seedInternal(["DEVELOPER"]);
  const id = await seedChangeAt(dev.actor, { status: "PIR" });

  await tx((t) =>
    recordPir(approver.actor, t, id, {
      valueRealized: "YES",
      lessons: "  went smoothly  ",
    }),
  );

  const pir = await db().postImplementationReview.findFirstOrThrow({
    where: { changeId: id },
  });
  expect(pir.valueRealized).toBe("YES");
  expect(pir.lessons).toBe("went smoothly");
  expect(pir.reviewedById).toBe(approver.id);
  const audit = await db().auditEvent.findFirstOrThrow({
    where: { action: "change.pir_recorded", subjectId: id },
  });
  expect(audit.payload).toEqual({ valueRealized: "YES" });

  await expect(
    tx((t) =>
      recordPir(approver.actor, t, id, {
        valueRealized: "NO",
        lessons: "second",
      }),
    ),
  ).rejects.toBeInstanceOf(ConflictError);
});

test("advancing to CLOSED with an originating demand notifies the demand's submitter with a 'Delivered' summary", async () => {
  const dev = await seedInternal(["DEVELOPER"]);
  const submitter = await seedInternal([]);
  const demand = await seedDemand(submitter.id);
  const id = await seedChangeAt(dev.actor, {
    status: "PIR",
    originatingDemandId: demand.id,
  });
  await db().postImplementationReview.create({
    data: {
      changeId: id,
      valueRealized: "YES",
      lessons: "delivered value",
      reviewedById: dev.id,
      reviewedAt: new Date(),
    },
  });

  await tx((t) => advanceChange(dev.actor, t, id, { from: "PIR" }));

  const row = await db().change.findUniqueOrThrow({ where: { id } });
  expect(row.status).toBe("CLOSED");
  expect(row.closedAt).not.toBeNull();

  const note = await db().notification.findFirstOrThrow({
    where: {
      userId: submitter.id,
      subjectType: "demand",
      subjectId: demand.id,
    },
  });
  expect((note.payload as { summary: string }).summary).toBe(
    "Your request has been delivered",
  );
  const closed = await db().auditEvent.findMany({
    where: { action: "change.closed", subjectId: id },
  });
  expect(closed).toHaveLength(1);
});
