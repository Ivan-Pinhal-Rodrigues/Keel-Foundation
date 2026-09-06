import { expect, test } from "vitest";
import { runWithContext } from "@/server/context";
import { reopenIncident } from "@/server/modules/incident/service";
import { sweepOverdueIncidents } from "@/server/modules/incident/sweep";
import type { Actor } from "@/server/policy/actor";
import { withTestDb } from "@/test/db";

const db = withTestDb();
const rand = () => Math.random().toString(16).slice(2);
const ctx = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithContext({ requestId: "r", actorId: "sys" }, fn);

async function seedInternal(): Promise<string> {
  const user = await db().user.create({
    data: {
      email: `i-${rand()}@k`,
      passwordHash: "x",
      displayName: "I",
      kind: "INTERNAL",
      hats: [],
    },
  });
  return user.id;
}

async function seedIncident(
  reportedById: string,
  overrides: Partial<{
    status: "NEW" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
    dueAt: Date;
    overdue: boolean;
    overdueNotifiedAt: Date | null;
    assigneeId: string;
  }> = {},
) {
  return db().incident.create({
    data: {
      ref: `INC-${rand()}`,
      title: "seeded",
      description: "d",
      affectedService: "s",
      impact: "MEDIUM",
      urgency: "MEDIUM",
      priority: "P3",
      status: overrides.status ?? "IN_PROGRESS",
      reportedById,
      assigneeId: overrides.assigneeId ?? null,
      dueAt: overrides.dueAt ?? new Date(Date.now() - 60 * 60 * 1000),
      overdue: overrides.overdue ?? false,
      overdueNotifiedAt:
        overrides.overdueNotifiedAt === undefined
          ? null
          : overrides.overdueNotifiedAt,
    },
  });
}

test("sweepOverdueIncidents flags a past-due open incident once, emits one OVERDUE notification per internal user + one incident.overdue audit, stamps overdueNotifiedAt", async () => {
  const reporter = await seedInternal();
  const assignee = await seedInternal();
  const inc = await seedIncident(reporter, { assigneeId: assignee });
  const internalCount = await db().user.count({
    where: { kind: "INTERNAL", isActive: true },
  });

  const first = await sweepOverdueIncidents({ db: db() });
  expect(first).toEqual({ flagged: 1, cleared: 0 });

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.overdue).toBe(true);
  expect(row.overdueNotifiedAt).not.toBeNull();

  const notes = await db().notification.findMany({
    where: { subjectId: inc.id, kind: "OVERDUE" },
  });
  expect(notes).toHaveLength(internalCount);
  expect(notes.map((n) => n.userId)).toContain(assignee);

  const audit = await db().auditEvent.findMany({
    where: { subjectId: inc.id, action: "incident.overdue" },
  });
  expect(audit).toHaveLength(1);
  expect(audit[0]!.actorId).toBeNull();

  // Second run: fires nothing more for the same incident.
  const second = await sweepOverdueIncidents({ db: db() });
  expect(second.flagged).toBe(0);
  expect(
    await db().notification.findMany({
      where: { subjectId: inc.id, kind: "OVERDUE" },
    }),
  ).toHaveLength(internalCount);
  expect(
    await db().auditEvent.findMany({
      where: { subjectId: inc.id, action: "incident.overdue" },
    }),
  ).toHaveLength(1);
});

test("sweepOverdueIncidents clears the stored overdue flag for an incident that has since been resolved", async () => {
  const reporter = await seedInternal();
  const inc = await seedIncident(reporter, {
    status: "RESOLVED",
    overdue: true,
    overdueNotifiedAt: new Date(),
  });

  const res = await sweepOverdueIncidents({ db: db() });
  expect(res.cleared).toBe(1);

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.overdue).toBe(false);

  expect(
    await db().notification.findMany({
      where: { subjectId: inc.id, kind: "OVERDUE" },
    }),
  ).toHaveLength(0);
});

test("clears the stored overdue flag for an incident re-categorised so dueAt is back in the future", async () => {
  const reporter = await seedInternal();
  const inc = await seedIncident(reporter, {
    status: "IN_PROGRESS",
    overdue: true,
    overdueNotifiedAt: new Date(),
    dueAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const res = await sweepOverdueIncidents({ db: db() });
  expect(res.cleared).toBe(1);

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.overdue).toBe(false);
});

test("reopenIncident clears overdue/overdueNotifiedAt so a later sweep can re-flag a still-past-due incident", async () => {
  const reporterId = await seedInternal();
  const devUser = await db().user.create({
    data: {
      email: `dev-${rand()}@k`,
      passwordHash: "x",
      displayName: "D",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  const dev: Actor = {
    id: devUser.id,
    kind: "INTERNAL",
    hats: ["DEVELOPER"],
    clientId: null,
  };
  const inc = await seedIncident(reporterId, {
    status: "RESOLVED",
    overdue: true,
    overdueNotifiedAt: new Date(),
    dueAt: new Date(Date.now() - 60 * 60 * 1000),
  });

  await ctx(() =>
    db().$transaction((tx) =>
      reopenIncident(dev, tx, inc.id, { reason: "regression" }),
    ),
  );

  const afterReopen = await db().incident.findUniqueOrThrow({
    where: { id: inc.id },
  });
  expect(afterReopen.overdue).toBe(false);
  expect(afterReopen.overdueNotifiedAt).toBeNull();

  const res = await sweepOverdueIncidents({ db: db() });
  expect(res.flagged).toBe(1);

  const reflagged = await db().incident.findUniqueOrThrow({
    where: { id: inc.id },
  });
  expect(reflagged.overdue).toBe(true);
  expect(reflagged.overdueNotifiedAt).not.toBeNull();
});

test("a not-yet-due incident is untouched", async () => {
  const reporter = await seedInternal();
  const inc = await seedIncident(reporter, {
    dueAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const res = await sweepOverdueIncidents({ db: db() });
  expect(res.flagged).toBe(0);

  const row = await db().incident.findUniqueOrThrow({ where: { id: inc.id } });
  expect(row.overdue).toBe(false);
  expect(row.overdueNotifiedAt).toBeNull();
});
