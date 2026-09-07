/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { GET as APPROVALS } from "@/app/api/approvals/route";
import { POST as APPROVE } from "@/app/api/changes/[id]/approve/[tier]/route";
import { POST as SUBMIT } from "@/app/api/changes/[id]/submit-for-approval/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let owner: TestActor;
let ownerTech: TestActor;
let tech: TestActor;
let business: TestActor;
let guest: TestActor;

beforeAll(async () => {
  const client = await db.client.create({
    data: { name: "Approval Flow Co", isActive: true },
  });
  guest = await asActor(
    await db.user.create({
      data: {
        email: "g-approval-flow@x.example",
        passwordHash: "x",
        displayName: "G",
        kind: "GUEST",
        hats: [],
        clientId: client.id,
      },
    }),
  );
  owner = await asActor(
    await db.user.create({
      data: {
        email: "owner-approval-flow@keel.local",
        passwordHash: "x",
        displayName: "O",
        kind: "INTERNAL",
        hats: ["DEVELOPER"],
      },
    }),
  );
  ownerTech = await asActor(
    await db.user.create({
      data: {
        email: "owner-tech-approval-flow@keel.local",
        passwordHash: "x",
        displayName: "OT",
        kind: "INTERNAL",
        hats: ["DEVELOPER", "TECHNICAL_APPROVER"],
      },
    }),
  );
  tech = await asActor(
    await db.user.create({
      data: {
        email: "tech-approval-flow@keel.local",
        passwordHash: "x",
        displayName: "T",
        kind: "INTERNAL",
        hats: ["TECHNICAL_APPROVER"],
      },
    }),
  );
  business = await asActor(
    await db.user.create({
      data: {
        email: "biz-approval-flow@keel.local",
        passwordHash: "x",
        displayName: "B",
        kind: "INTERNAL",
        hats: ["BUSINESS_APPROVER"],
      },
    }),
  );
}, 180_000);

async function seedChange(
  ownerId: string,
  opts: { riskLevel: "LOW" | "HIGH" },
): Promise<string> {
  const c = await db.change.create({
    data: {
      ref: `CHG-${Math.random().toString(16).slice(2, 8)}`,
      title: "Approval flow change",
      rfc: "rfc body",
      changeType: "NORMAL",
      status: "ASSESSING",
      ownerId,
      riskLevel: opts.riskLevel,
      impactAssessment: "assessed impact",
      rollbackPlan: "rollback steps",
    },
  });
  return c.id;
}

const P = (id: string, tier: string) => ({
  params: Promise.resolve({ id, tier }),
});

const submitReq = (actor?: TestActor) =>
  new Request("http://localhost:3000/api/changes/x/submit-for-approval", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(actor ? actor.headers : {}),
    },
    body: "{}",
  });

const approveReq = (body: unknown, actor?: TestActor) =>
  new Request("http://localhost:3000/api/changes/x/approve/y", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(actor ? actor.headers : {}),
    },
    body: JSON.stringify(body),
  });

const listReq = (actor?: TestActor) =>
  new Request("http://localhost:3000/api/approvals", {
    method: "GET",
    headers: { ...(actor ? actor.headers : {}) },
  });

test("LOW-risk: owner submits, a different TECHNICAL_APPROVER approves via POST /approve/technical → request APPROVED, change still APPROVAL", async () => {
  const id = await seedChange(owner.userId, { riskLevel: "LOW" });

  const s = await SUBMIT(submitReq(owner), P(id, ""));
  expect(s.status).toBe(200);
  expect(await s.json()).toEqual({ ok: true });
  let ch = await db.change.findUniqueOrThrow({ where: { id } });
  expect(ch.status).toBe("APPROVAL");

  const a = await APPROVE(
    approveReq({ decision: "APPROVED", reason: "looks safe" }, tech),
    P(id, "technical"),
  );
  expect(a.status).toBe(200);
  expect(await a.json()).toEqual({ ok: true });

  const req = await db.approvalRequest.findFirstOrThrow({
    where: { subjectType: "change", subjectId: id },
  });
  expect(req.status).toBe("APPROVED");
  ch = await db.change.findUniqueOrThrow({ where: { id } });
  expect(ch.status).toBe("APPROVAL");
});

test("HIGH-risk: tech approves then business approves; after tech, POST /approve/business by the tech user → 403 (wrong hat)", async () => {
  const id = await seedChange(owner.userId, { riskLevel: "HIGH" });
  await SUBMIT(submitReq(owner), P(id, ""));

  const t = await APPROVE(
    approveReq({ decision: "APPROVED", reason: "tech ok" }, tech),
    P(id, "technical"),
  );
  expect(t.status).toBe(200);

  const wrongHat = await APPROVE(
    approveReq({ decision: "APPROVED", reason: "not my job" }, tech),
    P(id, "business"),
  );
  expect(wrongHat.status).toBe(403);

  const b = await APPROVE(
    approveReq({ decision: "APPROVED", reason: "business ok" }, business),
    P(id, "business"),
  );
  expect(b.status).toBe(200);

  const req = await db.approvalRequest.findFirstOrThrow({
    where: { subjectType: "change", subjectId: id },
  });
  expect(req.status).toBe("APPROVED");
});

test("a rejection at the technical step: request REJECTED, change back to ASSESSING with the reason on the audit chain", async () => {
  const id = await seedChange(owner.userId, { riskLevel: "LOW" });
  await SUBMIT(submitReq(owner), P(id, ""));

  const r = await APPROVE(
    approveReq(
      { decision: "REJECTED", reason: "rollback plan is inadequate" },
      tech,
    ),
    P(id, "technical"),
  );
  expect(r.status).toBe(200);

  const req = await db.approvalRequest.findFirstOrThrow({
    where: { subjectType: "change", subjectId: id },
  });
  expect(req.status).toBe("REJECTED");

  const ch = await db.change.findUniqueOrThrow({ where: { id } });
  expect(ch.status).toBe("ASSESSING");

  const advanced = await db.auditEvent.findFirstOrThrow({
    where: { action: "change.advanced", subjectId: id, actorId: tech.userId },
  });
  expect(advanced.payload).toMatchObject({
    from: "APPROVAL",
    to: "ASSESSING",
    reason: "approval rejected",
  });
});

test("a retrospective REJECTED decision on an EMERGENCY change already at PIR: the change stays PIR, implementedAt is kept, and no change.advanced { from: APPROVAL } is written", async () => {
  const id = await seedChange(owner.userId, { riskLevel: "LOW" });
  await SUBMIT(submitReq(owner), P(id, ""));

  // The EMERGENCY change ran ahead of its still-PENDING approval: it is now at
  // PIR with implementedAt set. A retrospective decision then comes in REJECTED.
  const implementedAt = new Date();
  await db.change.update({
    where: { id },
    data: { status: "PIR", changeType: "EMERGENCY", implementedAt },
  });

  const r = await APPROVE(
    approveReq(
      { decision: "REJECTED", reason: "should not have shipped" },
      tech,
    ),
    P(id, "technical"),
  );
  expect(r.status).toBe(200);

  const req = await db.approvalRequest.findFirstOrThrow({
    where: { subjectType: "change", subjectId: id },
  });
  expect(req.status).toBe("REJECTED");

  const ch = await db.change.findUniqueOrThrow({ where: { id } });
  expect(ch.status).toBe("PIR");
  expect(ch.implementedAt).not.toBeNull();

  const advanced = await db.auditEvent.findMany({
    where: { action: "change.advanced", subjectId: id },
  });
  expect(
    advanced.some((a) => (a.payload as { from?: string }).from === "APPROVAL"),
  ).toBe(false);
});

test("the change OWNER hitting POST /approve/technical with no justification → 409 { error: 'segregation', overrideAction: 'change.approve.technical.override' }", async () => {
  const id = await seedChange(ownerTech.userId, { riskLevel: "LOW" });
  await SUBMIT(submitReq(ownerTech), P(id, ""));

  const res = await APPROVE(
    approveReq({ decision: "APPROVED", reason: "mine" }, ownerTech),
    P(id, "technical"),
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    error: "segregation",
    overrideAction: "change.approve.technical.override",
  });
});

test("the change owner with a >=20-char overrideJustification → 200, decision recorded as an override", async () => {
  const id = await seedChange(ownerTech.userId, { riskLevel: "LOW" });
  await SUBMIT(submitReq(ownerTech), P(id, ""));

  const res = await APPROVE(
    approveReq(
      {
        decision: "APPROVED",
        reason: "self-approved",
        overrideJustification: "sole technical approver on staff this week",
      },
      ownerTech,
    ),
    P(id, "technical"),
  );
  expect(res.status).toBe(200);

  const req = await db.approvalRequest.findFirstOrThrow({
    where: { subjectType: "change", subjectId: id },
    include: { steps: true },
  });
  expect(req.status).toBe("APPROVED");
  const decision = await db.approvalDecision.findFirstOrThrow({
    where: { stepId: req.steps[0]!.id },
  });
  expect(decision.isSingleApproverOverride).toBe(true);

  const override = await db.auditEvent.findMany({
    where: { action: "approval.override", subjectId: req.id },
  });
  expect(override).toHaveLength(1);
});

test("POST /approve/technical when the request is already resolved → 409 { error: 'conflict' }", async () => {
  const id = await seedChange(owner.userId, { riskLevel: "LOW" });
  await SUBMIT(submitReq(owner), P(id, ""));
  await APPROVE(
    approveReq({ decision: "APPROVED", reason: "ok" }, tech),
    P(id, "technical"),
  );

  const again = await APPROVE(
    approveReq({ decision: "APPROVED", reason: "again" }, tech),
    P(id, "technical"),
  );
  expect(again.status).toBe(409);
  expect(await again.json()).toEqual({ error: "conflict" });
});

test("an unknown approval tier → 404", async () => {
  const id = await seedChange(owner.userId, { riskLevel: "LOW" });
  await SUBMIT(submitReq(owner), P(id, ""));

  const res = await APPROVE(
    approveReq({ decision: "APPROVED", reason: "ok" }, tech),
    P(id, "sideways"),
  );
  expect(res.status).toBe(404);
});

test("a guest hitting POST /api/changes/:id/approve/technical → 403", async () => {
  const id = await seedChange(owner.userId, { riskLevel: "LOW" });
  await SUBMIT(submitReq(owner), P(id, ""));

  const res = await APPROVE(
    approveReq({ decision: "APPROVED", reason: "hi" }, guest),
    P(id, "technical"),
  );
  expect(res.status).toBe(403);
});

test("a guest cannot submit for approval → 403", async () => {
  const id = await seedChange(owner.userId, { riskLevel: "LOW" });
  const res = await SUBMIT(submitReq(guest), P(id, ""));
  expect(res.status).toBe(403);
});

test("a guest hitting POST /approve/technical on a change with NO pending approval step → 403 { error: 'forbidden' } (not 409 / conflict)", async () => {
  const draft = await db.change.create({
    data: {
      ref: `CHG-${Math.random().toString(16).slice(2, 8)}`,
      title: "Draft change, never submitted",
      rfc: "rfc body",
      changeType: "NORMAL",
      status: "DRAFT",
      ownerId: owner.userId,
      riskLevel: "LOW",
    },
  });

  const res = await APPROVE(
    approveReq({ decision: "APPROVED", reason: "hi" }, guest),
    P(draft.id, "technical"),
  );
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "forbidden" });
});

test("a guest hitting POST /approve/<bad tier> → 403 (not 404)", async () => {
  const id = await seedChange(owner.userId, { riskLevel: "LOW" });
  await SUBMIT(submitReq(owner), P(id, ""));

  const res = await APPROVE(
    approveReq({ decision: "APPROVED", reason: "hi" }, guest),
    P(id, "nonsense"),
  );
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "forbidden" });
});

test("GET /api/approvals: an actor holding the current step's hat sees the PENDING request; a guest → 403", async () => {
  const id = await seedChange(owner.userId, { riskLevel: "HIGH" });
  await SUBMIT(submitReq(owner), P(id, ""));

  const g = await APPROVALS(listReq(guest));
  expect(g.status).toBe(403);

  const res = await APPROVALS(listReq(tech));
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    approvals: {
      subjectType: string;
      subjectId: string;
      subjectRef: string;
      subjectTitle: string;
      policyKey: string;
      currentRequiredHat: string;
      needsOverride: boolean;
    }[];
  };
  const mine = body.approvals.find((a) => a.subjectId === id);
  expect(mine).toMatchObject({
    subjectType: "change",
    policyKey: "change.high_risk",
    currentRequiredHat: "TECHNICAL_APPROVER",
    needsOverride: false,
    subjectTitle: "Approval flow change",
  });
  expect(mine?.subjectRef).toMatch(/^CHG-/);

  // The business approver does not see it while the technical step is current.
  const biz = await APPROVALS(listReq(business));
  const bizBody = (await biz.json()) as { approvals: { subjectId: string }[] };
  expect(bizBody.approvals.find((a) => a.subjectId === id)).toBeUndefined();
});

test("GET /api/approvals: needsOverride is true when the actor is the request creator", async () => {
  const id = await seedChange(ownerTech.userId, { riskLevel: "LOW" });
  await SUBMIT(submitReq(ownerTech), P(id, ""));

  const res = await APPROVALS(listReq(ownerTech));
  const body = (await res.json()) as {
    approvals: { subjectId: string; needsOverride: boolean }[];
  };
  const mine = body.approvals.find((a) => a.subjectId === id);
  expect(mine?.needsOverride).toBe(true);
});
