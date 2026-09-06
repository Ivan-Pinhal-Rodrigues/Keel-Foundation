/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { POST as ASSIGN } from "@/app/api/incidents/[id]/assign/route";
import { PATCH as CATEGORIZE } from "@/app/api/incidents/[id]/categorize/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let incidentId = "";
let guestUserId = "";
let dev: TestActor;
let guest: TestActor;

beforeAll(async () => {
  const client = await db.client.create({
    data: { name: "Categorise Route Co", isActive: true },
  });
  const g = await db.user.create({
    data: {
      email: "g-cat-route@x.example",
      passwordHash: "x",
      displayName: "G",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  guestUserId = g.id;
  guest = await asActor(g);

  dev = await asActor(
    await db.user.create({
      data: {
        email: "dev-cat-route@keel.local",
        passwordHash: "x",
        displayName: "D",
        kind: "INTERNAL",
        hats: ["DEVELOPER"],
      },
    }),
  );

  const inc = await db.incident.create({
    data: {
      ref: `INC-${Math.random().toString(16).slice(2, 8)}`,
      title: "T",
      description: "D",
      affectedService: "s",
      impact: "LOW",
      urgency: "LOW",
      priority: "P4",
      status: "NEW",
      reportedById: dev.userId,
      dueAt: new Date("2026-01-01T00:00:00.000Z"),
      overdue: false,
    },
  });
  incidentId = inc.id;
}, 180_000);

const request = (
  method: "PATCH" | "POST",
  path: string,
  body: unknown,
  actor?: TestActor,
) =>
  new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(actor ? actor.headers : {}),
    },
    body: JSON.stringify(body),
  });

test("no session cookie → 401", async () => {
  const res = await CATEGORIZE(
    request("PATCH", "/api/incidents/x/categorize", {
      impact: "HIGH",
      urgency: "HIGH",
    }),
    { params: Promise.resolve({ id: incidentId }) },
  );
  expect(res.status).toBe(401);
});

test("a guest cannot categorise → 403", async () => {
  const res = await CATEGORIZE(
    request(
      "PATCH",
      "/api/incidents/x/categorize",
      { impact: "HIGH", urgency: "HIGH" },
      guest,
    ),
    { params: Promise.resolve({ id: incidentId }) },
  );
  expect(res.status).toBe(403);
});

test("an internal DEVELOPER categorises → 200 { ok: true } and the row is updated", async () => {
  const res = await CATEGORIZE(
    request(
      "PATCH",
      "/api/incidents/x/categorize",
      { impact: "HIGH", urgency: "HIGH" },
      dev,
    ),
    { params: Promise.resolve({ id: incidentId }) },
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const row = await db.incident.findUniqueOrThrow({
    where: { id: incidentId },
  });
  expect(row.impact).toBe("HIGH");
  expect(row.urgency).toBe("HIGH");
  expect(row.priority).toBe("P1");
});

test("assigning to a guest user id → 403", async () => {
  const res = await ASSIGN(
    request(
      "POST",
      "/api/incidents/x/assign",
      { assigneeId: guestUserId },
      dev,
    ),
    { params: Promise.resolve({ id: incidentId }) },
  );
  expect(res.status).toBe(403);

  const row = await db.incident.findUniqueOrThrow({
    where: { id: incidentId },
  });
  expect(row.status).toBe("NEW");
});

test("assigning to an active internal user → 200 and the incident is ASSIGNED", async () => {
  const other = await db.user.create({
    data: {
      email: "assignee-cat-route@keel.local",
      passwordHash: "x",
      displayName: "A",
      kind: "INTERNAL",
      hats: [],
    },
  });
  const res = await ASSIGN(
    request("POST", "/api/incidents/x/assign", { assigneeId: other.id }, dev),
    { params: Promise.resolve({ id: incidentId }) },
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const row = await db.incident.findUniqueOrThrow({
    where: { id: incidentId },
  });
  expect(row.status).toBe("ASSIGNED");
  expect(row.assigneeId).toBe(other.id);
});
