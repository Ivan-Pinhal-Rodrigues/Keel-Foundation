/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { GET, POST } from "@/app/api/changes/[id]/comments/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let changeId = "";
let reviewer: TestActor;
let developerOnly: TestActor;
let guest: TestActor;

beforeAll(async () => {
  const client = await db.client.create({
    data: { name: "Change Comments Co", isActive: true },
  });
  guest = await asActor(
    await db.user.create({
      data: {
        email: "g-chg-comments@x.example",
        passwordHash: "x",
        displayName: "G",
        kind: "GUEST",
        hats: [],
        clientId: client.id,
      },
    }),
  );

  const owner = await db.user.create({
    data: {
      email: "owner-chg-comments@keel.local",
      passwordHash: "x",
      displayName: "Owner",
      kind: "INTERNAL",
      hats: [],
    },
  });
  reviewer = await asActor(
    await db.user.create({
      data: {
        email: "rev-chg-comments@keel.local",
        passwordHash: "x",
        displayName: "Rey Reviewer",
        kind: "INTERNAL",
        hats: ["REVIEWER"],
      },
    }),
  );
  developerOnly = await asActor(
    await db.user.create({
      data: {
        email: "dev-chg-comments@keel.local",
        passwordHash: "x",
        displayName: "Dev",
        kind: "INTERNAL",
        hats: ["DEVELOPER"],
      },
    }),
  );

  const change = await db.change.create({
    data: {
      ref: `CHG-${Math.random().toString(16).slice(2, 8)}`,
      title: "Review thread change",
      rfc: "body",
      changeType: "NORMAL",
      status: "APPROVAL",
      ownerId: owner.id,
    },
  });
  changeId = change.id;
}, 180_000);

const url = () => `http://localhost:3000/api/changes/${changeId}/comments`;
const ctx = () => ({ params: Promise.resolve({ id: changeId }) });

const post = (body: unknown, actor?: TestActor) =>
  POST(
    new Request(url(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(actor ? actor.headers : {}),
      },
      body: JSON.stringify(body),
    }),
    ctx(),
  );

test("no session cookie → 401", async () => {
  const res = await GET(new Request(url()), ctx());
  expect(res.status).toBe(401);
});

test("GET returns { comments: [] } for a change with no review thread", async () => {
  const res = await GET(
    new Request(url(), { headers: reviewer.headers }),
    ctx(),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ comments: [] });
});

test("a guest → 403 (a change is never a guest surface)", async () => {
  const res = await GET(new Request(url(), { headers: guest.headers }), ctx());
  expect(res.status).toBe(403);
});

test("a REVIEWER POST → 201 with the re-listed thread", async () => {
  const res = await post(
    { body: "Confirm the rollback plan is current" },
    reviewer,
  );
  expect(res.status).toBe(201);
  const json = (await res.json()) as { comments: { body: string }[] };
  expect(json.comments).toHaveLength(1);
  expect(json.comments[0]?.body).toBe("Confirm the rollback plan is current");
});

test("a DEVELOPER-only POST → 403 (review needs the REVIEWER hat)", async () => {
  const res = await post({ body: "let me weigh in" }, developerOnly);
  expect(res.status).toBe(403);
});

test("a bad body → 400", async () => {
  const res = await post({ body: "" }, reviewer);
  expect(res.status).toBe(400);
});
