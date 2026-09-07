/** @vitest-environment node */
import { beforeAll, expect, test, vi } from "vitest";
import { GET } from "@/app/api/notifications/route";
import { POST } from "@/app/api/notifications/read/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let internal: TestActor;
let other: TestActor;
let guest: TestActor;

/** Three rows per user: two unread (i1, r1), one already read (d1). */
async function seedNotes(userId: string) {
  await db.notification.createMany({
    data: [
      {
        userId,
        kind: "ASSIGNED",
        subjectType: "Incident",
        subjectId: "i1",
        payload: { summary: "You were assigned INC-1" },
      },
      {
        userId,
        kind: "COMMENTED",
        subjectType: "Demand",
        subjectId: "d1",
        payload: { summary: "New comment on DEM-1" },
        readAt: new Date(),
      },
      {
        userId,
        kind: "APPROVAL_NEEDED",
        subjectType: "ApprovalRequest",
        subjectId: "r1",
        payload: { summary: "Approval needed on CHG-1" },
      },
    ],
  });
}

const mkUser = (
  kind: "INTERNAL" | "GUEST",
  extra: { clientId?: string | null } = {},
) =>
  db.user.create({
    data: {
      email: `n-${Math.random().toString(16).slice(2)}@k.example`,
      passwordHash: "x",
      displayName: "N",
      kind,
      hats: kind === "INTERNAL" ? ["DEVELOPER"] : [],
      clientId: extra.clientId ?? null,
    },
  });

beforeAll(async () => {
  const client = await db.client.create({
    data: { name: "Northwind Traders", isActive: true },
  });

  internal = await asActor(await mkUser("INTERNAL"));
  other = await asActor(await mkUser("INTERNAL"));
  guest = await asActor(await mkUser("GUEST", { clientId: client.id }));

  await seedNotes(internal.userId);
  await seedNotes(other.userId);
  await seedNotes(guest.userId);
}, 180_000);

const req = (
  url: string,
  init: { method: "GET" | "POST"; body?: unknown },
  actor?: TestActor,
) =>
  new Request(`http://localhost:3000${url}`, {
    method: init.method,
    headers: {
      "content-type": "application/json",
      ...(actor ? actor.headers : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

type ListBody = {
  notifications: {
    id: string;
    subjectId: string;
    href: string;
    readAt: string | null;
  }[];
  unreadCount: number;
};

test("no session cookie is 401", async () => {
  const res = await GET(req("/api/notifications", { method: "GET" }));
  expect(res.status).toBe(401);
});

test("GET as an internal user is 200 with only the actor's own rows", async () => {
  const res = await GET(req("/api/notifications", { method: "GET" }, internal));
  expect(res.status).toBe(200);
  const body = (await res.json()) as ListBody;
  expect(body.notifications).toHaveLength(3);
  expect(body.unreadCount).toBe(2);

  const othersIds = new Set(
    (
      await db.notification.findMany({
        where: { userId: other.userId },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  expect(body.notifications.every((n) => !othersIds.has(n.id))).toBe(true);
  expect(body.notifications.map((n) => n.subjectId).sort()).toEqual([
    "d1",
    "i1",
    "r1",
  ]);
});

test("GET ?unread=true returns only the unread rows", async () => {
  const res = await GET(
    req("/api/notifications?unread=true", { method: "GET" }, internal),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as ListBody;
  expect(body.notifications.map((n) => n.subjectId).sort()).toEqual([
    "i1",
    "r1",
  ]);
  expect(body.notifications.every((n) => n.readAt === null)).toBe(true);
});

test("GET ?kind=NONSENSE is 400 { error: invalid }", async () => {
  const res = await GET(
    req("/api/notifications?kind=NONSENSE", { method: "GET" }, internal),
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "invalid" });
});

test("a guest GET is 200 with the guest's own rows — not 403", async () => {
  const res = await GET(req("/api/notifications", { method: "GET" }, guest));
  expect(res.status).toBe(200);
  const body = (await res.json()) as ListBody;
  expect(body.notifications).toHaveLength(3);
  expect(body.unreadCount).toBe(2);
  expect(body.notifications.every((n) => n.href.startsWith("/portal"))).toBe(
    true,
  );
});

test("POST /read { ids } marks only the actor's own matching rows", async () => {
  const mine = await asActor(await mkUser("INTERNAL"));
  const theirs = await asActor(await mkUser("INTERNAL"));
  await seedNotes(mine.userId);
  await seedNotes(theirs.userId);

  const mineUnread = await db.notification.findMany({
    where: { userId: mine.userId, readAt: null },
    select: { id: true },
  });
  const theirsUnread = await db.notification.findMany({
    where: { userId: theirs.userId, readAt: null },
    select: { id: true },
  });

  const res = await POST(
    req(
      "/api/notifications/read",
      {
        method: "POST",
        body: { ids: [mineUnread[0]!.id, theirsUnread[0]!.id] },
      },
      mine,
    ),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ updated: 1 });

  const stillUnreadForThem = await db.notification.count({
    where: { userId: theirs.userId, readAt: null },
  });
  expect(stillUnreadForThem).toBe(2);
});

test("POST /read { all: true } clears every one of the actor's unread rows", async () => {
  const u = await asActor(await mkUser("INTERNAL"));
  await seedNotes(u.userId);

  const res = await POST(
    req("/api/notifications/read", { method: "POST", body: { all: true } }, u),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ updated: 2 });

  const left = await db.notification.count({
    where: { userId: u.userId, readAt: null },
  });
  expect(left).toBe(0);
});

test("POST /read {} (neither ids nor all) is 400", async () => {
  const res = await POST(
    req("/api/notifications/read", { method: "POST", body: {} }, internal),
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "invalid" });
});
