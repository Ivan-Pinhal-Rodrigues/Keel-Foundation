/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { GET as GET_ONE } from "@/app/api/changes/[id]/route";
import { GET, POST } from "@/app/api/changes/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let guest: TestActor;
let developer: TestActor;
let reviewer: TestActor;
let seededChangeId = "";

beforeAll(async () => {
  const client = await db.client.create({
    data: { name: "Northwind Traders", isActive: true },
  });
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
  developer = await asActor(
    await db.user.create({
      data: {
        email: "dev@keel.local",
        passwordHash: "x",
        displayName: "Dev",
        kind: "INTERNAL",
        hats: ["DEVELOPER"],
      },
    }),
  );
  reviewer = await asActor(
    await db.user.create({
      data: {
        email: "reviewer@keel.local",
        passwordHash: "x",
        displayName: "Reviewer",
        kind: "INTERNAL",
        hats: ["REVIEWER"],
      },
    }),
  );

  const change = await db.change.create({
    data: {
      ref: "CHG-ROUTE-1",
      title: "Seeded",
      changeType: "NORMAL",
      status: "DRAFT",
      ownerId: developer.userId,
    },
  });
  seededChangeId = change.id;
}, 180_000);

const request = (
  init: { method: "GET" | "POST"; body?: unknown },
  actor?: TestActor,
) =>
  new Request("http://localhost:3000/api/changes", {
    method: init.method,
    headers: {
      "content-type": "application/json",
      ...(actor ? actor.headers : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

const validBody = {
  title: "Upgrade the queue workers",
  rfc: "bump concurrency",
};

test("no session cookie is 401", async () => {
  const res = await POST(request({ method: "POST", body: validBody }));
  expect(res.status).toBe(401);
});

test("a guest create is 403 { error: forbidden }", async () => {
  const res = await POST(request({ method: "POST", body: validBody }, guest));
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: "forbidden" });
});

test("a guest list is 403 { error: forbidden }", async () => {
  const res = await GET(request({ method: "GET" }, guest));
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: "forbidden" });
});

test("a guest get is 403 { error: forbidden } (not 404)", async () => {
  const res = await GET_ONE(
    new Request(`http://localhost:3000/api/changes/${seededChangeId}`, {
      headers: guest.headers,
    }),
    { params: Promise.resolve({ id: seededChangeId }) },
  );
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: "forbidden" });
});

test("a DEVELOPER create is 201 { id, ref } with a CHG ref", async () => {
  const res = await POST(
    request({ method: "POST", body: validBody }, developer),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; ref: string };
  expect(body.id).toBeTruthy();
  expect(body.ref).toMatch(/^CHG-\d{4}$/);
});

test("a REVIEWER-only create is 403 (needs the DEVELOPER hat)", async () => {
  const res = await POST(
    request({ method: "POST", body: validBody }, reviewer),
  );
  expect(res.status).toBe(403);
});

test("GET list returns an array", async () => {
  const res = await GET(request({ method: "GET" }, developer));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { changes: unknown[] };
  expect(Array.isArray(body.changes)).toBe(true);
  expect(body.changes.length).toBeGreaterThan(0);
});
