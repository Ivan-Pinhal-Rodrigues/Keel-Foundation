/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { GET, POST } from "@/app/api/demands/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let clientId = "";
let guest: TestActor;

beforeAll(async () => {
  const client = await db.client.create({
    data: { name: "Northwind Traders", isActive: true },
  });
  clientId = client.id;

  guest = await asActor(
    await db.user.create({
      data: {
        email: "guest@northwind.example",
        passwordHash: "x",
        displayName: "Guest",
        kind: "GUEST",
        hats: [],
        clientId: client.id,
      },
    }),
  );
}, 180_000);

const request = (
  init: { method: "GET" | "POST"; body?: unknown },
  actor?: TestActor,
) =>
  new Request("http://localhost:3000/api/demands", {
    method: init.method,
    headers: {
      "content-type": "application/json",
      ...(actor ? actor.headers : {}),
    },
    body:
      init.body === undefined
        ? undefined
        : typeof init.body === "string"
          ? init.body
          : JSON.stringify(init.body),
  });

test("no session cookie is 401", async () => {
  const res = await POST(request({ method: "POST", body: { title: "x" } }));
  expect(res.status).toBe(401);
});

test("a body with an invalid source enum is 400 { error: invalid }", async () => {
  const res = await POST(
    request(
      {
        method: "POST",
        body: { title: "T", problem: "P", source: "NONSENSE" },
      },
      guest,
    ),
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "invalid" });
});

test("a valid guest create is 201 { id, ref }", async () => {
  const res = await POST(
    request(
      {
        method: "POST",
        body: { title: "Faster exports", problem: "slow", source: "CLIENT" },
      },
      guest,
    ),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; ref: string };
  expect(body.id).toBeTruthy();
  expect(body.ref).toMatch(/^DEM-\d{4}$/);

  const row = await db.demand.findUniqueOrThrow({ where: { id: body.id } });
  expect(row.clientId).toBe(clientId);
});

test("GET returns an array of serialized rows; guest rows carry no worth", async () => {
  const res = await GET(request({ method: "GET" }, guest));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { demands: Record<string, unknown>[] };
  expect(Array.isArray(body.demands)).toBe(true);
  expect(body.demands.length).toBeGreaterThan(0);
  for (const d of body.demands) {
    expect(d).not.toHaveProperty("worth");
    expect(d).not.toHaveProperty("submittedById");
  }
});

test("a guest GET /api/demands exposes only the allowlisted keys — no worth, submittedById, valueScore, or decidedAt", async () => {
  const res = await GET(request({ method: "GET" }, guest));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { demands: Record<string, unknown>[] };
  expect(body.demands.length).toBeGreaterThan(0);

  const allowed = new Set([
    "id",
    "ref",
    "title",
    "problem",
    "source",
    "affectedService",
    "createdAt",
    "status",
    "clientName",
  ]);
  for (const d of body.demands) {
    for (const key of Object.keys(d)) {
      expect(allowed.has(key)).toBe(true);
    }
    expect(d).not.toHaveProperty("worth");
    expect(d).not.toHaveProperty("submittedById");
    expect(d).not.toHaveProperty("valueScore");
    expect(d).not.toHaveProperty("decidedAt");
    // The plain-word status, never the raw enum.
    expect(d.status).not.toMatch(/^[A-Z_]+$/);
  }
});
