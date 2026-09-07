import { readFileSync } from "node:fs";
import { beforeAll, expect, test } from "vitest";
import { buildOverview } from "@/server/modules/overview/service";
import type { Actor } from "@/server/policy/actor";
import { ForbiddenError } from "@/server/policy/errors";
import { withTestDb } from "@/test/db";

/**
 * End-to-end integration test for `buildOverview` (plan-04 Task 13).
 *
 * Seeds one full fixture — demands across every status (incl. an APPROVED/PURSUE
 * and a REJECTED), an overdue incident assigned to the actor, a change the actor
 * owns, a SCHEDULED change with a window five days out, a PENDING approval whose
 * current step's hat the actor holds, a TRIAGING demand missing its value score,
 * a FAILED `EmailOutbox` row, and a dozen audit events — then asserts every
 * branch of the composed payload in a single `test()`.
 */

const db = withTestDb();
const rand = () => Math.random().toString(16).slice(2);

const F: { actor: Actor; guest: Actor; refs: Record<string, string> } = {
  actor: null!,
  guest: null!,
  refs: {},
};

/** A fixture ref, asserted present (satisfies `noUncheckedIndexedAccess`). */
const ref = (k: string): string => {
  const v = F.refs[k];
  if (v === undefined) throw new Error(`no fixture ref: ${k}`);
  return v;
};

beforeAll(async () => {
  const me = await db().user.create({
    data: {
      email: `me-${rand()}@k.example`,
      passwordHash: "x",
      displayName: "Dev Approver",
      kind: "INTERNAL",
      hats: ["DEVELOPER", "BUSINESS_APPROVER"],
    },
  });
  const other = await db().user.create({
    data: {
      email: `other-${rand()}@k.example`,
      passwordHash: "x",
      displayName: "Other",
      kind: "INTERNAL",
      hats: ["TECHNICAL_APPROVER"],
    },
  });
  const client = await db().client.create({
    data: { name: `C-${rand()}`, isActive: true },
  });

  F.actor = { id: me.id, kind: "INTERNAL", hats: me.hats, clientId: null };
  F.guest = { id: "guest", kind: "GUEST", hats: [], clientId: client.id };

  // --- demands: one per status, incl. APPROVED/PURSUE and REJECTED --------
  const mkDemand = async (
    key: string,
    status:
      | "SUBMITTED"
      | "TRIAGING"
      | "WORTH_ASSESSED"
      | "APPROVED"
      | "REJECTED"
      | "CONVERTED",
    createdAt: Date,
    worth?: {
      valueScore?: number | null;
      effort?: "S" | "M" | "L" | null;
      decision?: "PURSUE" | "PARK" | "DROP" | null;
    },
  ) => {
    const demandRef = `DEM-${rand()}`;
    F.refs[key] = demandRef;
    const demand = await db().demand.create({
      data: {
        ref: demandRef,
        title: key,
        problem: "p",
        source: "INTERNAL",
        status,
        submittedById: other.id,
        createdAt,
      },
    });
    if (worth) {
      await db().worthAssessment.create({
        data: {
          demandId: demand.id,
          valueScore: worth.valueScore ?? null,
          effort: worth.effort ?? null,
          decision: worth.decision ?? null,
        },
      });
    }
    return demand;
  };

  await mkDemand("subm", "SUBMITTED", new Date("2026-05-01"));
  // TRIAGING with no value score — the BUSINESS_APPROVER actor must action it.
  await mkDemand("triage", "TRIAGING", new Date("2026-06-01"), {
    valueScore: null,
    effort: "M",
  });
  await mkDemand("wa", "WORTH_ASSESSED", new Date("2026-06-02"), {
    valueScore: 5,
    effort: "M",
  });
  await mkDemand("appr", "APPROVED", new Date("2026-06-03"), {
    valueScore: 8,
    effort: "S",
    decision: "PURSUE",
  });
  await mkDemand("rej", "REJECTED", new Date("2026-06-04"), {
    valueScore: 1,
    effort: "L",
    decision: "DROP",
  });
  await mkDemand("conv", "CONVERTED", new Date("2026-06-05"), {
    valueScore: 9,
    effort: "S",
    decision: "PURSUE",
  });

  // --- an overdue incident assigned to the actor ------------------------
  const overdue = await db().incident.create({
    data: {
      ref: `INC-${rand()}`,
      title: "portal 500s",
      description: "d",
      affectedService: "Portal",
      impact: "HIGH",
      urgency: "HIGH",
      priority: "P1",
      status: "IN_PROGRESS",
      reportedById: other.id,
      assigneeId: me.id,
      dueAt: new Date("2020-01-01"),
      overdue: true,
    },
  });
  F.refs.overdue = overdue.ref;

  // --- a change the actor owns ----------------------------------------
  const mine = await db().change.create({
    data: {
      ref: `CHG-${rand()}`,
      title: "owned draft",
      changeType: "NORMAL",
      status: "DRAFT",
      ownerId: me.id,
    },
  });
  F.refs.mine = mine.ref;

  // --- a SCHEDULED change with a window five days out (not the actor's) --
  const day = 24 * 60 * 60 * 1000;
  const scheduled = await db().change.create({
    data: {
      ref: `CHG-${rand()}`,
      title: "scheduled window",
      changeType: "NORMAL",
      status: "SCHEDULED",
      ownerId: other.id,
      windowStart: new Date(Date.now() + 5 * day),
      windowEnd: new Date(Date.now() + 5 * day + 60 * 60 * 1000),
    },
  });
  F.refs.scheduled = scheduled.ref;

  // --- a PENDING approval whose current step's hat the actor holds -----
  const approvalChange = await db().change.create({
    data: {
      ref: `CHG-${rand()}`,
      title: "awaiting approval",
      changeType: "NORMAL",
      status: "APPROVAL",
      ownerId: other.id,
    },
  });
  F.refs.approvalChange = approvalChange.ref;
  await db().approvalRequest.create({
    data: {
      subjectType: "change",
      subjectId: approvalChange.id,
      policyKey: "change.standard",
      createdById: other.id,
      status: "PENDING",
      steps: {
        create: [
          { order: 1, requiredHat: "BUSINESS_APPROVER", status: "PENDING" },
        ],
      },
    },
  });

  // --- a FAILED outbound email --------------------------------------
  await db().emailOutbox.create({
    data: {
      toEmail: "bounce@k.example",
      template: "demand_decided",
      payload: { ref: "DEM-9" },
      status: "FAILED",
      attempts: 6,
      lastError: "mailbox full",
    },
  });

  // --- a dozen audit events for the activity strip -----------------
  const actions = [
    "demand.create",
    "demand.triage_started",
    "demand.value_scored",
    "demand.decided",
    "incident.create",
    "incident.assigned",
    "incident.transitioned",
    "incident.resolved",
    "change.created",
    "change.scheduled",
    "approval.request_opened",
    "approval.step_approved",
  ];
  await db().auditEvent.createMany({
    data: actions.map((action, i) => ({
      at: new Date(Date.parse("2026-09-01T00:00:00Z") + i * 60_000),
      action,
      subjectType: "Demand",
      subjectId: `s-${i}`,
      requestId: "seed",
    })),
  });
}, 180_000);

test("buildOverview end-to-end: tiles, queue, approvals, funnel, windows, email failures, activity", async () => {
  const o = await buildOverview(F.actor, db());

  // --- tiles: every count hand-computed -----------------------------
  expect(o.tiles).toEqual({
    myOpenItems: 2, // overdue incident (mine) + owned DRAFT change
    approvalsWaiting: 1, // the BUSINESS_APPROVER pending step
    overdue: 1, // the one overdue incident
    demandsInTriage: 2, // TRIAGING + WORTH_ASSESSED
  });

  // --- myQueue: the incident (overdue, first), the change, the demand --
  const byRef = new Map(o.myQueue.map((q) => [q.ref, q]));
  expect([...byRef.keys()].sort()).toEqual(
    [ref("overdue"), ref("mine"), ref("triage")].sort(),
  );
  expect(o.myQueue[0]!.ref).toBe(ref("overdue"));
  expect(o.myQueue[0]!.overdue).toBe(true);
  expect(o.myQueue[0]!.sortKey).toBe(0);

  const inc = byRef.get(ref("overdue"))!;
  const chg = byRef.get(ref("mine"))!;
  const dem = byRef.get(ref("triage"))!;
  expect(inc.href).toBe(`/incidents?open=${inc.id}`);
  expect(chg.href).toBe(`/changes?open=${chg.id}`);
  expect(dem.href).toBe(`/demands?open=${dem.id}`);
  expect(dem.hint).toBe("Needs your value score");
  expect(chg.overdue).toBe(false);

  // --- approvals: the pending request, href /approvals ---------------
  expect(o.approvals).toHaveLength(1);
  expect(o.approvals[0]).toMatchObject({
    subjectType: "change",
    subjectRef: ref("approvalChange"),
    subjectTitle: "awaiting approval",
    currentRequiredHat: "BUSINESS_APPROVER",
    needsOverride: false,
    href: "/approvals",
  });

  // --- funnel: sums to (total demands − REJECTED); no rejected stage --
  const total = await db().demand.count();
  const rejected = await db().demand.count({ where: { status: "REJECTED" } });
  expect(rejected).toBe(1);
  expect(o.funnel.reduce((n, s) => n + s.count, 0)).toBe(total - rejected);
  expect(o.funnel.some((s) => /reject/i.test(s.stage))).toBe(false);

  // --- windows: only the five-day change ---------------------------
  expect(o.windows.map((w) => w.ref)).toEqual([ref("scheduled")]);

  // --- email failures --------------------------------------------
  expect(o.emailFailures.count).toBe(1);

  // --- activity: >= 10 items, each with a non-empty label -------
  expect(o.activity.length).toBeGreaterThanOrEqual(10);
  expect(
    o.activity.every((a) => typeof a.label === "string" && a.label.length > 0),
  ).toBe(true);

  // --- a guest is rejected with ForbiddenError before any read runs --
  await expect(buildOverview(F.guest, db())).rejects.toBeInstanceOf(
    ForbiddenError,
  );

  // --- architecture: overview/service.ts composes module reads only --
  const src = readFileSync(new URL("../service.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(
    /@prisma\/client|@\/server\/db\/client|\.\$queryRaw|\.\$executeRaw/,
  );
});
