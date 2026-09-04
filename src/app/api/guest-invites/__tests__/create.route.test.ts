import { beforeAll, expect, test, vi } from "vitest";
import { POST } from "@/app/api/guest-invites/route";
import { type TestActor, withRouteTestDb } from "@/test/route-db";

/**
 * The DB seam and the per-file lifecycle both live in `@/test/route-db` — see
 * that file for why the `vi.mock` factory has to reach it by dynamic import.
 * These two statements replace the ~25 lines the other Phase 0 route tests
 * still carry.
 */
vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();

let clientId = "";
let internal: TestActor;
let guest: TestActor;

beforeAll(async () => {
  const client = await db.client.create({
    data: { name: "Wonka Industries", isActive: true },
  });
  clientId = client.id;

  internal = await asActor(
    await db.user.create({
      data: {
        email: "pm@keel.local",
        passwordHash: "x",
        displayName: "PM",
        kind: "INTERNAL",
        hats: ["DEVELOPER"],
      },
    }),
    { ip: "10.0.0.1" },
  );

  guest = await asActor(
    await db.user.create({
      data: {
        email: "existing-guest@wonka.example",
        passwordHash: "x",
        displayName: "Guest",
        kind: "GUEST",
        hats: [],
        clientId: client.id,
      },
    }),
    { ip: "10.0.0.2" },
  );
}, 180_000);

const post = (body: unknown, actor?: TestActor) =>
  POST(
    new Request("http://localhost:3000/api/guest-invites", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(actor ? actor.headers : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

test("an internal actor gets 200 { url } and a GuestInvite + audit row land", async () => {
  const res = await post(
    { clientId, email: "invitee@wonka.example" },
    internal,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { url: string };
  expect(body.url).toContain("/portal/invite/");

  const invite = await db.guestInvite.findFirstOrThrow({
    where: { email: "invitee@wonka.example" },
  });
  expect(invite.clientId).toBe(clientId);
  expect(invite.redeemedAt).toBeNull();

  const ev = await db.auditEvent.findFirstOrThrow({
    where: { action: "guest_invite.created", subjectId: invite.id },
  });
  expect(ev.subjectType).toBe("GuestInvite");
  expect(ev.requestId).toBeTruthy();
});

test("a guest actor is refused with 403 { error: forbidden }", async () => {
  const before = await db.guestInvite.count();
  const res = await post(
    { clientId, email: "guest-tried@wonka.example" },
    guest,
  );
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "forbidden" });
  expect(await db.guestInvite.count()).toBe(before);
});

test("a malformed body is 400", async () => {
  expect((await post({ clientId }, internal)).status).toBe(400);
  expect(
    (await post({ clientId, email: "not-an-email" }, internal)).status,
  ).toBe(400);
  expect((await post("}{ not json", internal)).status).toBe(400);
});

test("no session cookie is 401 (withRequest / getActor)", async () => {
  const res = await post({ clientId, email: "anon@wonka.example" });
  expect(res.status).toBe(401);
});
