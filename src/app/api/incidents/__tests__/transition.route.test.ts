/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { POST as REOPEN } from "@/app/api/incidents/[id]/reopen/route";
import { POST as TRANSITION } from "@/app/api/incidents/[id]/transition/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let dev: TestActor;
let guest: TestActor;
let inProgressId = "";
let resolvedId = "";
let guestInProgressId = "";

async function seedIncident(
  reportedById: string,
  status: "IN_PROGRESS" | "RESOLVED",
): Promise<string> {
  const inc = await db.incident.create({
    data: {
      ref: `INC-${Math.random().toString(16).slice(2, 8)}`,
      title: "T",
      description: "D",
      affectedService: "s",
      impact: "MEDIUM",
      urgency: "MEDIUM",
      priority: "P3",
      status,
      reportedById,
      dueAt: new Date("2026-01-01T00:00:00.000Z"),
      overdue: false,
    },
  });
  return inc.id;
}

beforeAll(async () => {
  const client = await db.client.create({
    data: { name: "Transition Route Co", isActive: true },
  });
  const g = await db.user.create({
    data: {
      email: "g-transition-route@x.example",
      passwordHash: "x",
      displayName: "G",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  guest = await asActor(g);
  dev = await asActor(
    await db.user.create({
      data: {
        email: "dev-transition-route@keel.local",
        passwordHash: "x",
        displayName: "D",
        kind: "INTERNAL",
        hats: ["DEVELOPER"],
      },
    }),
  );

  inProgressId = await seedIncident(dev.userId, "IN_PROGRESS");
  resolvedId = await seedIncident(dev.userId, "RESOLVED");
  guestInProgressId = await seedIncident(dev.userId, "IN_PROGRESS");
}, 180_000);

const request = (path: string, body: unknown, actor?: TestActor) =>
  new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(actor ? actor.headers : {}),
    },
    body: JSON.stringify(body),
  });

test("no session cookie → 401", async () => {
  const res = await TRANSITION(
    request("/api/incidents/x/transition", {
      to: "RESOLVED",
      resolution: "done",
    }),
    { params: Promise.resolve({ id: inProgressId }) },
  );
  expect(res.status).toBe(401);
});

test("a guest cannot transition → 403", async () => {
  const res = await TRANSITION(
    request(
      "/api/incidents/x/transition",
      { to: "RESOLVED", resolution: "done" },
      guest,
    ),
    { params: Promise.resolve({ id: guestInProgressId }) },
  );
  expect(res.status).toBe(403);

  const row = await db.incident.findUniqueOrThrow({
    where: { id: guestInProgressId },
  });
  expect(row.status).toBe("IN_PROGRESS");
});

test("resolve without a resolution → 403", async () => {
  const res = await TRANSITION(
    request("/api/incidents/x/transition", { to: "RESOLVED" }, dev),
    { params: Promise.resolve({ id: inProgressId }) },
  );
  expect(res.status).toBe(403);
});

test("a DEVELOPER resolves → 200 { ok: true } and the row is RESOLVED", async () => {
  const res = await TRANSITION(
    request(
      "/api/incidents/x/transition",
      { to: "RESOLVED", resolution: "patched the query" },
      dev,
    ),
    { params: Promise.resolve({ id: inProgressId }) },
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const row = await db.incident.findUniqueOrThrow({
    where: { id: inProgressId },
  });
  expect(row.status).toBe("RESOLVED");
  expect(row.resolution).toBe("patched the query");
});

test("reopen a RESOLVED incident → 200 and it is IN_PROGRESS", async () => {
  const res = await REOPEN(
    request("/api/incidents/x/reopen", { reason: "regression found" }, dev),
    { params: Promise.resolve({ id: resolvedId }) },
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const row = await db.incident.findUniqueOrThrow({
    where: { id: resolvedId },
  });
  expect(row.status).toBe("IN_PROGRESS");
});

test("an out-of-set transition target → 400 (schema rejects it)", async () => {
  const res = await TRANSITION(
    request("/api/incidents/x/transition", { to: "NEW" }, dev),
    { params: Promise.resolve({ id: resolvedId }) },
  );
  expect(res.status).toBe(400);
});
