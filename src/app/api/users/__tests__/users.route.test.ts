/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { GET } from "@/app/api/users/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let internalName = "";
let guestName = "";
let internal: TestActor;
let guest: TestActor;

beforeAll(async () => {
  const client = await db.client.create({
    data: { name: "Users Route Co", isActive: true },
  });

  const g = await db.user.create({
    data: {
      email: "guest-users-route@x.example",
      passwordHash: "x",
      displayName: "Gary Guest",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  guestName = g.displayName;
  guest = await asActor(g);

  const dev = await db.user.create({
    data: {
      email: "dev-users-route@keel.local",
      passwordHash: "x",
      displayName: "Dana Developer",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  internalName = dev.displayName;
  internal = await asActor(dev);

  // An inactive internal user must never show up in the picker.
  await db.user.create({
    data: {
      email: "retired-users-route@keel.local",
      passwordHash: "x",
      displayName: "Rita Retired",
      kind: "INTERNAL",
      hats: [],
      isActive: false,
    },
  });
}, 180_000);

const request = (actor?: TestActor) =>
  new Request("http://localhost:3000/api/users?kind=INTERNAL", {
    method: "GET",
    headers: { ...(actor ? actor.headers : {}) },
  });

test("no session cookie → 401", async () => {
  const res = await GET(request());
  expect(res.status).toBe(401);
});

test("a guest → 403", async () => {
  const res = await GET(request(guest));
  expect(res.status).toBe(403);
});

test("an internal actor → 200 { users } with active internal users only", async () => {
  const res = await GET(request(internal));
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    users: { id: string; displayName: string }[];
  };
  expect(Array.isArray(body.users)).toBe(true);

  const names = body.users.map((u) => u.displayName);
  expect(names).toContain(internalName);
  expect(names).not.toContain(guestName);
  expect(names).not.toContain("Rita Retired");

  for (const u of body.users) {
    expect(Object.keys(u).sort()).toEqual(["displayName", "id"]);
  }
});
