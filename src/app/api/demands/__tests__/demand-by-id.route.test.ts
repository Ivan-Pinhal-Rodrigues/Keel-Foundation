/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { GET } from "@/app/api/demands/[id]/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let demandId = "";
let internal: TestActor;
let otherGuest: TestActor;

beforeAll(async () => {
  const clientA = await db.client.create({
    data: { name: "Client A route-by-id", isActive: true },
  });
  const clientB = await db.client.create({
    data: { name: "Client B route-by-id", isActive: true },
  });

  const submitter = await db.user.create({
    data: {
      email: "a-guest@a.example",
      passwordHash: "x",
      displayName: "A Guest",
      kind: "GUEST",
      hats: [],
      clientId: clientA.id,
    },
  });

  const demand = await db.demand.create({
    data: {
      ref: "DEM-ROUTEID",
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
        email: "pm-by-id@keel.local",
        passwordHash: "x",
        displayName: "PM",
        kind: "INTERNAL",
        hats: ["DEVELOPER"],
      },
    }),
  );

  otherGuest = await asActor(
    await db.user.create({
      data: {
        email: "b-guest@b.example",
        passwordHash: "x",
        displayName: "B Guest",
        kind: "GUEST",
        hats: [],
        clientId: clientB.id,
      },
    }),
  );
}, 180_000);

const req = (actor: TestActor) =>
  new Request(`http://localhost:3000/api/demands/${demandId}`, {
    headers: { ...actor.headers },
  });

test("internal GET /api/demands/:id → 200 with the serialized demand", async () => {
  const res = await GET(req(internal), {
    params: Promise.resolve({ id: demandId }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.id).toBe(demandId);
  expect(body.ref).toBe("DEM-ROUTEID");
  expect(body).toHaveProperty("status", "SUBMITTED");
});

test("a guest from another client GET /api/demands/:id → 404 (not 403)", async () => {
  const res = await GET(req(otherGuest), {
    params: Promise.resolve({ id: demandId }),
  });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
});
