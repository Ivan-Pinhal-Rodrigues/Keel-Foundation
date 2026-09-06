/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { POST as LINK } from "@/app/api/changes/[id]/link-incident/route";
import { PATCH as EDIT } from "@/app/api/changes/[id]/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let changeId = "";
let incidentId = "";
let owner: TestActor;
let guest: TestActor;

beforeAll(async () => {
  const client = await db.client.create({
    data: { name: "Change Route Co", isActive: true },
  });
  guest = await asActor(
    await db.user.create({
      data: {
        email: "g-chg-route@x.example",
        passwordHash: "x",
        displayName: "G",
        kind: "GUEST",
        hats: [],
        clientId: client.id,
      },
    }),
  );

  const ownerUser = await db.user.create({
    data: {
      email: "owner-chg-route@keel.local",
      passwordHash: "x",
      displayName: "O",
      kind: "INTERNAL",
      hats: [],
    },
  });
  owner = await asActor(ownerUser);

  const change = await db.change.create({
    data: {
      ref: `CHG-${Math.random().toString(16).slice(2, 8)}`,
      title: "T",
      rfc: "original body",
      changeType: "NORMAL",
      status: "DRAFT",
      ownerId: ownerUser.id,
    },
  });
  changeId = change.id;

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
      reportedById: ownerUser.id,
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

const params = (id: string) => ({ params: Promise.resolve({ id }) });

test("no session cookie → 401", async () => {
  const res = await EDIT(
    request("PATCH", "/api/changes/x", { rfc: "new" }),
    params(changeId),
  );
  expect(res.status).toBe(401);
});

test("a guest cannot edit a change → 403", async () => {
  const res = await EDIT(
    request("PATCH", "/api/changes/x", { rfc: "new" }, guest),
    params(changeId),
  );
  expect(res.status).toBe(403);
});

test("a guest cannot link an incident → 403", async () => {
  const res = await LINK(
    request(
      "POST",
      "/api/changes/x/link-incident",
      { incidentId, kind: "FIXES" },
      guest,
    ),
    params(changeId),
  );
  expect(res.status).toBe(403);
});

test("the owner edits their change → 200 { ok: true } and the row is updated", async () => {
  const res = await EDIT(
    request(
      "PATCH",
      "/api/changes/x",
      { rfc: "revised body", riskLevel: "MEDIUM" },
      owner,
    ),
    params(changeId),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const row = await db.change.findUniqueOrThrow({ where: { id: changeId } });
  expect(row.rfc).toBe("revised body");
  expect(row.riskLevel).toBe("MEDIUM");
});

test("the owner links an incident → 200 { ok: true } and the join row exists", async () => {
  const res = await LINK(
    request(
      "POST",
      "/api/changes/x/link-incident",
      { incidentId, kind: "FIXES" },
      owner,
    ),
    params(changeId),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const link = await db.changeIncidentLink.findFirstOrThrow({
    where: { changeId, incidentId, kind: "FIXES" },
  });
  expect(link.incidentId).toBe(incidentId);
});

test("linking an unknown incident → 404", async () => {
  const res = await LINK(
    request(
      "POST",
      "/api/changes/x/link-incident",
      { incidentId: "does-not-exist", kind: "FIXES" },
      owner,
    ),
    params(changeId),
  );
  expect(res.status).toBe(404);
});
