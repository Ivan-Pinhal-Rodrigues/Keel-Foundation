/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { GET, POST } from "@/app/api/demands/[id]/comments/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let demandId = "";
let internal: TestActor;
let ownGuest: TestActor;
let otherGuest: TestActor;

beforeAll(async () => {
  const clientA = await db.client.create({
    data: { name: "Comments Route A", isActive: true },
  });
  const clientB = await db.client.create({
    data: { name: "Comments Route B", isActive: true },
  });

  const submitter = await db.user.create({
    data: {
      email: "submitter-comments@a.example",
      passwordHash: "x",
      displayName: "Submitter",
      kind: "GUEST",
      hats: [],
      clientId: clientA.id,
    },
  });

  const demand = await db.demand.create({
    data: {
      ref: "DEM-COMMENTS",
      title: "Faster exports",
      problem: "slow",
      source: "CLIENT",
      status: "SUBMITTED",
      submittedById: submitter.id,
      clientId: clientA.id,
    },
  });
  demandId = demand.id;

  internal = await asActor(
    await db.user.create({
      data: {
        email: "pm-comments@keel.local",
        passwordHash: "x",
        displayName: "PM",
        kind: "INTERNAL",
        hats: ["DEVELOPER"],
      },
    }),
  );
  ownGuest = await asActor(submitter);
  otherGuest = await asActor(
    await db.user.create({
      data: {
        email: "other-comments@b.example",
        passwordHash: "x",
        displayName: "Other",
        kind: "GUEST",
        hats: [],
        clientId: clientB.id,
      },
    }),
  );
}, 180_000);

const url = `http://localhost:3000/api/demands/${demandId}/comments`;
const ctx = () => ({ params: Promise.resolve({ id: demandId }) });

test("GET returns { comments: [] } for a fresh demand", async () => {
  const res = await GET(new Request(url, { headers: internal.headers }), ctx());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ comments: [] });
});

test("POST creates a comment and returns 201 with the re-listed thread", async () => {
  const res = await POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...internal.headers },
      body: JSON.stringify({
        body: "First look at this",
        visibleToClient: true,
      }),
    }),
    ctx(),
  );
  expect(res.status).toBe(201);
  const json = (await res.json()) as { comments: { body: string }[] };
  expect(json.comments).toHaveLength(1);
  expect(json.comments[0]?.body).toBe("First look at this");
});

test("the guest submitter sees the client-visible comment", async () => {
  const res = await GET(new Request(url, { headers: ownGuest.headers }), ctx());
  expect(res.status).toBe(200);
  const json = (await res.json()) as { comments: unknown[] };
  expect(json.comments).toHaveLength(1);
});

test("a guest from another client → 404", async () => {
  const res = await GET(
    new Request(url, { headers: otherGuest.headers }),
    ctx(),
  );
  expect(res.status).toBe(404);
});

test("a bad body → 400", async () => {
  const res = await POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...internal.headers },
      body: JSON.stringify({ body: "" }),
    }),
    ctx(),
  );
  expect(res.status).toBe(400);
});

test("no session cookie → 401", async () => {
  const res = await GET(new Request(url), ctx());
  expect(res.status).toBe(401);
});
