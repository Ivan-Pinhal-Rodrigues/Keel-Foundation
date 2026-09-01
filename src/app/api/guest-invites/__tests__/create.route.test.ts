import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { POST } from "@/app/api/guest-invites/route";
import { createSession } from "@/server/auth/session";
import { prisma as db } from "@/server/db/client";
import { applyMigrationsToNewSchema, dropSchema } from "@/test/db";

/** Same DB seam as the login route test: the singleton is mocked and bound to a
 *  schema this file owns, so `withRequest` (session resolution) and
 *  `runInTransaction` (the invite write + audit) all land in `test_*`. */
const { schema } = await vi.hoisted(async () => {
  const { randomBytes } = await import("node:crypto");
  return { schema: `test_${randomBytes(6).toString("hex")}` };
});

vi.mock("@/server/db/client", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { migrateUrlForSchema } = await import("@/test/db");
  return {
    prisma: new PrismaClient({
      datasources: { db: { url: migrateUrlForSchema(schema) } },
    }),
  };
});

let clientId = "";
let internalToken = "";
let guestToken = "";

beforeAll(async () => {
  await applyMigrationsToNewSchema(schema);

  const client = await db.client.create({
    data: { name: "Wonka Industries", isActive: true },
  });
  clientId = client.id;

  const internal = await db.user.create({
    data: {
      email: "pm@keel.local",
      passwordHash: "x",
      displayName: "PM",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  internalToken = (await createSession(internal.id, { ip: "10.0.0.1" })).token;

  const guest = await db.user.create({
    data: {
      email: "existing-guest@wonka.example",
      passwordHash: "x",
      displayName: "Guest",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  guestToken = (await createSession(guest.id, { ip: "10.0.0.2" })).token;
}, 180_000);

afterAll(async () => {
  await db.$disconnect();
  await dropSchema(schema);
}, 120_000);

const post = (body: unknown, token?: string) =>
  POST(
    new Request("http://localhost:3000/api/guest-invites", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { cookie: `authjs.session-token=${token}` } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

test("an internal actor gets 200 { url } and a GuestInvite + audit row land", async () => {
  const res = await post(
    { clientId, email: "invitee@wonka.example" },
    internalToken,
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
    guestToken,
  );
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "forbidden" });
  expect(await db.guestInvite.count()).toBe(before);
});

test("a malformed body is 400", async () => {
  expect((await post({ clientId }, internalToken)).status).toBe(400);
  expect(
    (await post({ clientId, email: "not-an-email" }, internalToken)).status,
  ).toBe(400);
  expect((await post("}{ not json", internalToken)).status).toBe(400);
});

test("no session cookie is 401 (withRequest / getActor)", async () => {
  const res = await post({ clientId, email: "anon@wonka.example" });
  expect(res.status).toBe(401);
});
