/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { GET } from "@/app/api/overview/route";
import { overviewResponse } from "@/lib/api/schemas/overview";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let internal: TestActor;
let guest: TestActor;

const mkUser = (kind: "INTERNAL" | "GUEST", clientId: string | null = null) =>
  db.user.create({
    data: {
      email: `o-${Math.random().toString(16).slice(2)}@k.example`,
      passwordHash: "x",
      displayName: "O",
      kind,
      hats: kind === "INTERNAL" ? ["TECHNICAL_APPROVER"] : [],
      clientId,
    },
  });

beforeAll(async () => {
  const client = await db.client.create({
    data: { name: "Acme", isActive: true },
  });
  internal = await asActor(await mkUser("INTERNAL"));
  guest = await asActor(await mkUser("GUEST", client.id));
}, 180_000);

const req = (actor?: TestActor) =>
  new Request("http://localhost:3000/api/overview", {
    method: "GET",
    headers: { ...(actor ? actor.headers : {}) },
  });

test("no session cookie is 401", async () => {
  const res = await GET(req());
  expect(res.status).toBe(401);
});

test("a guest is 403", async () => {
  const res = await GET(req(guest));
  expect(res.status).toBe(403);
});

test("an internal actor is 200 with a payload matching overviewResponse", async () => {
  const res = await GET(req(internal));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(() => overviewResponse.parse(body)).not.toThrow();
});
