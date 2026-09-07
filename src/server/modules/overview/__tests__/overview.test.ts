import { readFileSync } from "node:fs";
import { beforeAll, expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { buildOverview } from "@/server/modules/overview/service";
import type { Actor } from "@/server/policy/actor";
import { ForbiddenError } from "@/server/policy/errors";

const db = withTestDb();
const rand = () => Math.random().toString(16).slice(2);

/** A fixture ref, asserted present (satisfies `noUncheckedIndexedAccess`). */
const ref = (k: string): string => {
  const v = F.refs[k];
  if (v === undefined) throw new Error(`no fixture ref: ${k}`);
  return v;
};

// Fixture ids captured for the assertions.
const F: {
  me: Actor;
  biz: Actor;
  tech: Actor;
  guest: Actor;
  refs: Record<string, string>;
} = { me: null!, biz: null!, tech: null!, guest: null!, refs: {} };

const mkUser = (hats: Actor["hats"]) =>
  db().user.create({
    data: {
      email: `u-${rand()}@k.example`,
      passwordHash: "x",
      displayName: "U",
      kind: "INTERNAL",
      hats,
    },
  });

const incidentBase = (reportedById: string) => ({
  description: "d",
  affectedService: "svc",
  impact: "MEDIUM" as const,
  urgency: "MEDIUM" as const,
  priority: "P3" as const,
  status: "NEW" as const,
  reportedById,
  overdue: false,
});

beforeAll(async () => {
  const meU = await mkUser(["BUSINESS_APPROVER", "TECHNICAL_APPROVER"]);
  const bizU = await mkUser(["BUSINESS_APPROVER"]);
  const techU = await mkUser(["TECHNICAL_APPROVER"]);
  const otherU = await mkUser(["DEVELOPER"]);
  const client = await db().client.create({
    data: { name: `C-${rand()}`, isActive: true },
  });

  F.me = { id: meU.id, kind: "INTERNAL", hats: meU.hats, clientId: null };
  F.biz = { id: bizU.id, kind: "INTERNAL", hats: bizU.hats, clientId: null };
  F.tech = { id: techU.id, kind: "INTERNAL", hats: techU.hats, clientId: null };
  F.guest = { id: "guest", kind: "GUEST", hats: [], clientId: client.id };

  // --- demands, one per status --------------------------------------------
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
        submittedById: otherU.id,
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

  await mkDemand("s1", "SUBMITTED", new Date("2026-05-01"));
  await mkDemand("s2", "SUBMITTED", new Date("2026-05-02"));
  // T1: value missing (BUSINESS_APPROVER sees it), effort present.
  await mkDemand("t1", "TRIAGING", new Date("2026-06-01"), {
    valueScore: null,
    effort: "M",
  });
  // T2: effort missing (TECHNICAL_APPROVER sees it), value present.
  await mkDemand("t2", "TRIAGING", new Date("2026-06-02"), {
    valueScore: 5,
    effort: null,
  });
  // T3: both missing (either hat sees it).
  await mkDemand("t3", "TRIAGING", new Date("2026-06-03"), {
    valueScore: null,
    effort: null,
  });
  await mkDemand("wa", "WORTH_ASSESSED", new Date("2026-06-04"), {
    valueScore: 5,
    effort: "M",
  });
  await mkDemand("a1", "APPROVED", new Date("2026-06-05"), {
    valueScore: 8,
    effort: "S",
    decision: "PURSUE",
  });
  await mkDemand("a2", "APPROVED", new Date("2026-06-06"), {
    valueScore: 3,
    effort: "L",
    decision: "PARK",
  });
  await mkDemand("rej", "REJECTED", new Date("2026-06-07"), {
    valueScore: 1,
    effort: "L",
    decision: "DROP",
  });
  await mkDemand("conv", "CONVERTED", new Date("2026-06-08"), {
    valueScore: 9,
    effort: "S",
    decision: "PURSUE",
  });

  // --- incidents ---------------------------------------------------------
  const overdueMine = await db().incident.create({
    data: {
      ...incidentBase(otherU.id),
      ref: `INC-${rand()}`,
      title: "overdue-mine",
      status: "IN_PROGRESS",
      assigneeId: meU.id,
      dueAt: new Date("2020-01-01"),
    },
  });
  F.refs.overdueMine = overdueMine.ref;
  const openMine = await db().incident.create({
    data: {
      ...incidentBase(otherU.id),
      ref: `INC-${rand()}`,
      title: "open-mine",
      status: "ASSIGNED",
      assigneeId: meU.id,
      dueAt: new Date("2030-01-01"),
    },
  });
  F.refs.openMine = openMine.ref;
  await db().incident.create({
    data: {
      ...incidentBase(otherU.id),
      ref: `INC-${rand()}`,
      title: "resolved-mine",
      status: "RESOLVED",
      assigneeId: meU.id,
      dueAt: new Date("2020-01-01"),
      resolution: "fixed",
      resolvedAt: new Date(),
    },
  });
  // Overdue but not assigned to me — counts to tiles.overdue only.
  await db().incident.create({
    data: {
      ...incidentBase(otherU.id),
      ref: `INC-${rand()}`,
      title: "overdue-other",
      status: "NEW",
      dueAt: new Date("2020-02-01"),
    },
  });

  // --- changes ---------------------------------------------------------
  const draftMine = await db().change.create({
    data: {
      ref: `CHG-${rand()}`,
      title: "draft-mine",
      changeType: "NORMAL",
      status: "DRAFT",
      ownerId: meU.id,
    },
  });
  F.refs.draftMine = draftMine.ref;
  await db().change.create({
    data: {
      ref: `CHG-${rand()}`,
      title: "closed-mine",
      changeType: "NORMAL",
      status: "CLOSED",
      ownerId: meU.id,
    },
  });
  const day = 24 * 60 * 60 * 1000;
  const scheduledSoon = await db().change.create({
    data: {
      ref: `CHG-${rand()}`,
      title: "scheduled-soon",
      changeType: "NORMAL",
      status: "SCHEDULED",
      ownerId: otherU.id,
      windowStart: new Date(Date.now() + 3 * day),
      windowEnd: new Date(Date.now() + 3 * day + 60 * 60 * 1000),
    },
  });
  F.refs.scheduledSoon = scheduledSoon.ref;

  // --- an approval whose current step hat `me` holds -------------------
  const approvalChange = await db().change.create({
    data: {
      ref: `CHG-${rand()}`,
      title: "awaiting-approval",
      changeType: "NORMAL",
      status: "APPROVAL",
      ownerId: otherU.id,
    },
  });
  F.refs.approvalChange = approvalChange.ref;
  await db().approvalRequest.create({
    data: {
      subjectType: "change",
      subjectId: approvalChange.id,
      policyKey: "change.standard",
      createdById: otherU.id,
      status: "PENDING",
      steps: {
        create: [
          { order: 1, requiredHat: "TECHNICAL_APPROVER", status: "PENDING" },
        ],
      },
    },
  });

  // --- audit events for the activity strip ----------------------------
  await db().auditEvent.createMany({
    data: [
      {
        at: new Date("2026-09-01T00:00:00Z"),
        action: "demand.create",
        subjectType: "Demand",
        subjectId: "d-x",
        requestId: "seed",
      },
      {
        at: new Date("2026-09-02T00:00:00Z"),
        action: "incident.create",
        subjectType: "Incident",
        subjectId: "i-x",
        requestId: "seed",
      },
      {
        at: new Date("2026-09-03T00:00:00Z"),
        action: "approval.request_opened",
        subjectType: "ApprovalRequest",
        subjectId: "r-x",
        requestId: "seed",
      },
    ],
  });

  // --- a failed outbound email ---------------------------------------
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
}, 180_000);

test("buildOverview: every tile, funnel, windows and email-failure count", async () => {
  const o = await buildOverview(F.me, db());

  expect(o.tiles).toEqual({
    myOpenItems: 3, // overdue-mine + open-mine incidents + draft-mine change
    approvalsWaiting: 1,
    overdue: 2, // overdue-mine + overdue-other
    demandsInTriage: 4, // 3 TRIAGING + 1 WORTH_ASSESSED
  });

  // funnel: submitted → triaging → worth_assessed → approved(pursue) → converted
  expect(o.funnel).toEqual([
    { stage: "submitted", label: "Submitted", count: 2 },
    { stage: "triaging", label: "Triaging", count: 3 },
    { stage: "worth_assessed", label: "Worth assessed", count: 1 },
    { stage: "approved", label: "Approved (pursue)", count: 1 }, // a1 only, a2 is PARK
    { stage: "converted", label: "Converted", count: 1 },
  ]);
  // REJECTED is never a stage.
  expect(o.funnel.some((s) => /reject/i.test(s.stage))).toBe(false);

  expect(o.windows.map((w) => w.ref)).toContain(ref("scheduledSoon"));
  const w = o.windows.find((x) => x.ref === ref("scheduledSoon"))!;
  expect(typeof w.windowStart).toBe("string");
  expect(w.windowStart).toBe(new Date(w.windowStart).toISOString());

  expect(o.emailFailures.count).toBe(1);
  expect(o.emailFailures.recent[0]).toEqual({
    toEmail: "bounce@k.example",
    template: "demand_decided",
    lastError: "mailbox full",
    attempts: 6,
  });

  expect(o.approvals).toEqual([
    {
      subjectType: "change",
      subjectId: expect.any(String),
      subjectRef: ref("approvalChange"),
      subjectTitle: "awaiting-approval",
      currentRequiredHat: "TECHNICAL_APPROVER",
      needsOverride: false,
      href: "/approvals",
    },
  ]);

  // activity: newest-first, `text` a sentence from label + subjectType + subjectId
  expect(o.activity.map((a) => a.text).slice(0, 3)).toEqual([
    "Approval requested — ApprovalRequest r-x",
    "Incident reported — Incident i-x",
    "Demand raised — Demand d-x",
  ]);
});

test("buildOverview: myQueue membership, overdue flag and sort order", async () => {
  const o = await buildOverview(F.me, db());
  const byRef = new Map(o.myQueue.map((q) => [q.ref, q]));

  // incidents (mine, open) + change (mine, open) + triaging demands for my hats
  expect([...byRef.keys()].sort()).toEqual(
    [
      ref("overdueMine"),
      ref("openMine"),
      ref("draftMine"),
      ref("t1"),
      ref("t2"),
      ref("t3"),
    ].sort(),
  );
  expect(byRef.has(ref("scheduledSoon"))).toBe(false); // not mine

  expect(byRef.get(ref("overdueMine"))!.overdue).toBe(true);
  expect(byRef.get(ref("overdueMine"))!.hint).toBe("SLA overdue");
  expect(byRef.get(ref("openMine"))!.overdue).toBe(false);
  expect(byRef.get(ref("draftMine"))!.hint).toBe("You own this change");

  // overdue → sortKey 0 → first; keys non-decreasing; the window-less change last
  expect(o.myQueue[0]!.ref).toBe(ref("overdueMine"));
  expect(o.myQueue[0]!.sortKey).toBe(0);
  const keys = o.myQueue.map((q) => q.sortKey);
  expect([...keys].sort((a, b) => a - b)).toEqual(keys);
  expect(o.myQueue.at(-1)!.ref).toBe(ref("draftMine"));
});

test("buildOverview is actor-relative: BUSINESS vs TECHNICAL vs all hats", async () => {
  const biz = await buildOverview(F.biz, db());
  const tech = await buildOverview(F.tech, db());
  const all = await buildOverview(F.me, db());

  // biz has no assigned incidents / owned changes — only the value-missing demands
  expect(biz.myQueue.map((q) => q.ref).sort()).toEqual(
    [ref("t1"), ref("t3")].sort(),
  );
  expect(biz.myQueue.every((q) => q.hint === "Needs your value score")).toBe(
    true,
  );

  expect(tech.myQueue.map((q) => q.ref).sort()).toEqual(
    [ref("t2"), ref("t3")].sort(),
  );
  expect(
    tech.myQueue.every((q) => q.hint === "Needs your effort estimate"),
  ).toBe(true);

  // all-hats actor sees the union of the triaging demands
  const allDemandRefs = all.myQueue
    .filter((q) => q.kind === "demand")
    .map((q) => q.ref)
    .sort();
  expect(allDemandRefs).toEqual([ref("t1"), ref("t2"), ref("t3")].sort());
});

test("buildOverview: a guest is rejected with ForbiddenError", async () => {
  await expect(buildOverview(F.guest, db())).rejects.toBeInstanceOf(
    ForbiddenError,
  );
});

test("architecture: overview/service.ts composes module reads only — no Prisma", () => {
  const src = readFileSync("src/server/modules/overview/service.ts", "utf8");
  expect(src).not.toMatch(/@prisma\/client/);
  expect(src).not.toMatch(/@\/server\/db\/client/);
  expect(src).not.toMatch(/\$queryRaw/);
  expect(src).not.toMatch(/\$executeRaw/);
});
