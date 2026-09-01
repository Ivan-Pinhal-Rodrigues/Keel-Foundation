import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { POST } from "@/app/api/guest-invites/[token]/redeem/route";
import { sha256 } from "@/server/auth/invites";
import { getSessionAndUser } from "@/server/auth/session";
import { prisma as db } from "@/server/db/client";
import { applyMigrationsToNewSchema, dropSchema } from "@/test/db";

/** Same DB seam as the login route test — the singleton is mocked and bound to
 *  a schema this file owns, so `runInTransaction` (redeem) and `createSession`
 *  land in `test_*`. */
const { schema } = await vi.hoisted(async () => {
  const { randomBytes: rb } = await import("node:crypto");
  return { schema: `test_${rb(6).toString("hex")}` };
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

beforeAll(async () => {
  await applyMigrationsToNewSchema(schema);
  const client = await db.client.create({
    data: { name: "Cyberdyne", isActive: true },
  });
  clientId = client.id;
}, 180_000);

afterAll(async () => {
  await db.$disconnect();
  await dropSchema(schema);
}, 120_000);

async function seedInvite(expiresAt = new Date(Date.now() + 7 * 86_400_000)) {
  const raw = randomBytes(32).toString("base64url");
  await db.guestInvite.create({
    data: {
      token: sha256(raw),
      clientId,
      email: `redeem-${randomBytes(5).toString("hex")}@cyberdyne.example`,
      createdById: "u-internal",
      expiresAt,
    },
  });
  return raw;
}

const post = (token: string, body: unknown) =>
  POST(
    new Request(`http://localhost:3000/api/guest-invites/${token}/redeem`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "vitest-agent",
        "x-forwarded-for": "198.51.100.7",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );

test("a valid redemption → 200, a session cookie, and User + Session rows", async () => {
  const raw = await seedInvite();
  const res = await post(raw, {
    name: "Sarah Connor",
    password: "no fate but what we make",
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie).toMatch(/authjs\.session-token=/);
  expect(setCookie).toMatch(/HttpOnly/i);

  const token = decodeURIComponent(
    /authjs\.session-token=([^;]+)/.exec(setCookie)?.[1] ?? "",
  );
  const resolved = await getSessionAndUser(token, db);
  expect(resolved?.user.kind).toBe("GUEST");
  expect(resolved?.user.clientId).toBe(clientId);
  expect(resolved?.user.displayName).toBe("Sarah Connor");

  // The route (no withRequest) opened its own context, so writeAudit had a
  // requestId to stamp.
  const ev = await db.auditEvent.findFirstOrThrow({
    where: { action: "guest_invite.redeemed", actorId: resolved?.user.id },
  });
  expect(ev.requestId).toBeTruthy();
});

test("an expired invite → 410 { error: gone }", async () => {
  const raw = await seedInvite(new Date(Date.now() - 1000));
  const res = await post(raw, { name: "X", password: "hunter2hunter2" });
  expect(res.status).toBe(410);
  expect(await res.json()).toEqual({ error: "gone" });
});

test("an unknown token → 410", async () => {
  const res = await post(randomBytes(32).toString("base64url"), {
    name: "X",
    password: "hunter2hunter2",
  });
  expect(res.status).toBe(410);
});

test("a malformed body → 400", async () => {
  const raw = await seedInvite();
  expect((await post(raw, { name: "" })).status).toBe(400);
  expect((await post(raw, { name: "Ok", password: "short" })).status).toBe(400);
  expect((await post(raw, "}{ not json")).status).toBe(400);
  // The invite is untouched by a rejected request.
  const invite = await db.guestInvite.findFirstOrThrow({
    where: { token: sha256(raw) },
  });
  expect(invite.redeemedAt).toBeNull();
});
