/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { POST as DECIDE } from "@/app/api/demands/[id]/decision/route";
import { POST as REJECT } from "@/app/api/demands/[id]/reject/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let assessedId = "";
let submitterAssessedId = "";
let guestOwnDemandId = "";
let approver: TestActor;
let submitterApprover: TestActor;
let guestActor: TestActor;

async function seedAssessed(submittedById: string, clientId: string | null) {
  const demand = await db.demand.create({
    data: {
      ref: `DEM-${Math.random().toString(16).slice(2, 8)}`,
      title: "T",
      problem: "P",
      source: "CLIENT",
      status: "WORTH_ASSESSED",
      submittedById,
      clientId,
    },
  });
  await db.worthAssessment.create({
    data: {
      demandId: demand.id,
      businessValue: "high",
      valueScore: 7,
      effort: "M",
      costOfDelay: "compounding",
    },
  });
  return demand.id;
}

beforeAll(async () => {
  const client = await db.client.create({
    data: { name: "Decision Route Co", isActive: true },
  });
  const guest = await db.user.create({
    data: {
      email: "g-decision@x.example",
      passwordHash: "x",
      displayName: "G",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });

  approver = await asActor(
    await db.user.create({
      data: {
        email: "approver-decision@keel.local",
        passwordHash: "x",
        displayName: "A",
        kind: "INTERNAL",
        hats: ["BUSINESS_APPROVER"],
      },
    }),
  );
  submitterApprover = await asActor(
    await db.user.create({
      data: {
        email: "self-approver-decision@keel.local",
        passwordHash: "x",
        displayName: "S",
        kind: "INTERNAL",
        hats: ["BUSINESS_APPROVER"],
      },
    }),
  );

  guestActor = await asActor(guest);

  assessedId = await seedAssessed(guest.id, client.id);
  submitterAssessedId = await seedAssessed(submitterApprover.userId, null);
  guestOwnDemandId = await seedAssessed(guest.id, client.id);
}, 180_000);

const decideReq = (body: unknown, actor?: TestActor) =>
  new Request(`http://localhost:3000/api/demands/x/decision`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(actor ? actor.headers : {}),
    },
    body: JSON.stringify(body),
  });

test("no session cookie → 401", async () => {
  const res = await DECIDE(decideReq({ decision: "PURSUE" }), {
    params: Promise.resolve({ id: assessedId }),
  });
  expect(res.status).toBe(401);
});

test("a non-submitter approver decides → 200 { ok: true }", async () => {
  const res = await DECIDE(decideReq({ decision: "PURSUE" }, approver), {
    params: Promise.resolve({ id: assessedId }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  const d = await db.demand.findUniqueOrThrow({ where: { id: assessedId } });
  expect(d.status).toBe("APPROVED");
});

test("the submitter deciding their own demand → 409 { error: segregation, overrideAction }", async () => {
  const res = await DECIDE(
    decideReq({ decision: "PURSUE" }, submitterApprover),
    { params: Promise.resolve({ id: submitterAssessedId }) },
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    error: "segregation",
    overrideAction: "demand.decide.override",
  });
});

test("the submitter with a >=20-char justification → 200 and the override is recorded", async () => {
  const res = await DECIDE(
    decideReq(
      {
        decision: "PARK",
        overrideJustification: "sole approver this week; co-founder away",
      },
      submitterApprover,
    ),
    { params: Promise.resolve({ id: submitterAssessedId }) },
  );
  expect(res.status).toBe(200);
  const w = await db.worthAssessment.findUniqueOrThrow({
    where: { demandId: submitterAssessedId },
  });
  expect(w.isSingleApproverOverride).toBe(true);
});

test("an authed guest cannot decide or reject — even on their own client's demand → 403", async () => {
  const dec = await DECIDE(decideReq({ decision: "PURSUE" }, guestActor), {
    params: Promise.resolve({ id: guestOwnDemandId }),
  });
  expect(dec.status).toBe(403);

  const rej = await REJECT(
    new Request("http://localhost:3000/api/demands/x/reject", {
      method: "POST",
      headers: { "content-type": "application/json", ...guestActor.headers },
      body: JSON.stringify({ reason: "please do not decline this" }),
    }),
    { params: Promise.resolve({ id: guestOwnDemandId }) },
  );
  expect(rej.status).toBe(403);

  const d = await db.demand.findUniqueOrThrow({
    where: { id: guestOwnDemandId },
  });
  expect(d.status).toBe("WORTH_ASSESSED");
});

test("reject → 200 and the demand lands REJECTED with the reason", async () => {
  const client = await db.client.create({
    data: { name: "Reject Route Co", isActive: true },
  });
  const guest = await db.user.create({
    data: {
      email: "g-reject@x.example",
      passwordHash: "x",
      displayName: "G",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  const id = await seedAssessed(guest.id, client.id);
  const res = await REJECT(
    new Request("http://localhost:3000/api/demands/x/reject", {
      method: "POST",
      headers: { "content-type": "application/json", ...approver.headers },
      body: JSON.stringify({ reason: "out of scope for this quarter" }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(res.status).toBe(200);
  const d = await db.demand.findUniqueOrThrow({ where: { id } });
  expect(d.status).toBe("REJECTED");
  expect(d.rejectionReason).toBe("out of scope for this quarter");
});
