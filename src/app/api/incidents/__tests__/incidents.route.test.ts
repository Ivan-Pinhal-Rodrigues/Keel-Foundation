/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { GET, POST } from "@/app/api/incidents/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let clientId = "";
let guest: TestActor;
let internal: TestActor;

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
  internal = await asActor(
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
}, 180_000);

const request = (
  init: { method: "GET" | "POST"; body?: unknown },
  actor?: TestActor,
) =>
  new Request("http://localhost:3000/api/incidents", {
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

test("a guest body carrying impact is ignored (extra key stripped) and the row is MEDIUM / MEDIUM / P3", async () => {
  const res = await POST(
    request(
      {
        method: "POST",
        body: {
          title: "Login broken",
          description: "cannot sign in",
          affectedService: "portal",
          affectingLevel: "whole team blocked",
          impact: "HIGH",
        },
      },
      guest,
    ),
  );
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string; ref: string };

  const row = await db.incident.findUniqueOrThrow({ where: { id } });
  expect(row.impact).toBe("MEDIUM");
  expect(row.urgency).toBe("MEDIUM");
  expect(row.priority).toBe("P3");
  expect(row.clientId).toBe(clientId);
});

test("an internal body missing impact is 400 { error: invalid }", async () => {
  const res = await POST(
    request(
      {
        method: "POST",
        body: {
          title: "T",
          description: "D",
          affectedService: "svc",
          urgency: "LOW",
        },
      },
      internal,
    ),
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "invalid" });
});

test("a valid internal create is 201 { id, ref }", async () => {
  const res = await POST(
    request(
      {
        method: "POST",
        body: {
          title: "Queue stalled",
          description: "workers idle",
          affectedService: "jobs",
          impact: "HIGH",
          urgency: "HIGH",
        },
      },
      internal,
    ),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; ref: string };
  expect(body.id).toBeTruthy();
  expect(body.ref).toMatch(/^INC-\d{4}$/);
});

test("GET guest list rows carry none of impact / priority / assigneeId", async () => {
  const res = await GET(request({ method: "GET" }, guest));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { incidents: Record<string, unknown>[] };
  expect(Array.isArray(body.incidents)).toBe(true);
  expect(body.incidents.length).toBeGreaterThan(0);
  for (const i of body.incidents) {
    expect(i).not.toHaveProperty("impact");
    expect(i).not.toHaveProperty("priority");
    expect(i).not.toHaveProperty("assigneeId");
  }
});
