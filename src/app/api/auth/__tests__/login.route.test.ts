import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { POST } from "@/app/api/auth/login/route";
import { hashPassword } from "@/server/auth/password";
import { getSessionAndUser } from "@/server/auth/session";
import { prisma as db } from "@/server/db/client";
import { applyMigrationsToNewSchema, dropSchema } from "@/test/db";

/**
 * Testability seam.
 *
 * The route reaches the database through the app singleton — by design: route
 * handlers may not import a Prisma client, and `session.ts`'s optional client
 * parameter is for transactions, not for tests. So the singleton module itself
 * is mocked, bound to a schema this file owns. `login.ts` and `tx.ts`'s
 * `runInTransaction` resolve to the same mocked module, so the whole request
 * path — verify, session insert, audit insert — runs in `test_*` and `public`
 * is never touched. The test then imports that same client to seed and assert.
 *
 * The schema name is minted in `vi.hoisted` because the mock factory runs
 * during the import phase, before any top-level statement or hook.
 */
const { schema } = await vi.hoisted(async () => {
  // `vi.hoisted` runs before this file's imports, so `node:crypto` is pulled in
  // here rather than used from the import above.
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

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

let userId = "";

beforeAll(async () => {
  await applyMigrationsToNewSchema(schema);
  const u = await db.user.create({
    data: {
      email: "cto@keel.local",
      passwordHash: await hashPassword("secret12"),
      displayName: "CTO",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  userId = u.id;
}, 180_000);

afterAll(async () => {
  await db.$disconnect();
  await dropSchema(schema);
}, 120_000);

/** One login request. Each test uses its own client IP so the per-IP rate
 *  limiter (module state, shared across a file) cannot leak between tests. */
const login = (body: unknown, ip: string) =>
  POST(
    new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `${ip}, 10.0.0.9`,
        "user-agent": "vitest-agent",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

test("valid credentials → 200, a session cookie, one Session row, one auth.login event", async () => {
  const res = await login(
    { email: "cto@keel.local", password: "secret12" },
    "203.0.113.1",
  );
  expect(res.status).toBe(200);

  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toMatch(/authjs\.session-token=/);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=Lax/i);

  const token = decodeURIComponent(
    /authjs\.session-token=([^;]+)/.exec(setCookie ?? "")?.[1] ?? "",
  );
  expect(token).toBeTruthy();

  const rows = await db.session.findMany({ where: { userId } });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.ip).toBe("203.0.113.1");
  expect(rows[0]?.userAgent).toBe("vitest-agent");
  // Stored hashed, not raw — the cookie value is never in the table.
  expect(rows[0]?.sessionToken).toBe(sha256(token));
  expect(rows[0]?.sessionToken).not.toBe(token);

  expect((await getSessionAndUser(token, db))?.user.id).toBe(userId);

  const events = await db.auditEvent.findMany({
    where: { action: "auth.login" },
  });
  expect(events).toHaveLength(1);
  expect(events[0]?.actorId).toBe(userId);
  expect(events[0]?.subjectType).toBe("User");
  expect(events[0]?.subjectId).toBe(userId);
  expect(events[0]?.requestId).toBeTruthy();
});

test("bad credentials → 401, no cookie, no session, one auth.login_failed event", async () => {
  const sessionsBefore = await db.session.count();
  const res = await login(
    { email: "cto@keel.local", password: "nope" },
    "203.0.113.2",
  );
  expect(res.status).toBe(401);
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(await db.session.count()).toBe(sessionsBefore);

  const events = await db.auditEvent.findMany({
    where: { action: "auth.login_failed", subjectId: "cto@keel.local" },
  });
  expect(events).toHaveLength(1);
  // §3.4: the actor is the attempted email, not a user id.
  expect(events[0]?.actorId).toBeNull();
  expect(events[0]?.subjectType).toBe("auth");
  expect(events[0]?.payload).toEqual({
    email: "cto@keel.local",
    reason: "invalid_credentials",
  });
  expect(events[0]?.requestId).toBeTruthy();
});

test("an unknown email → 401 and an auth.login_failed event naming it", async () => {
  const res = await login(
    { email: "ghost@keel.local", password: "secret12" },
    "203.0.113.7",
  );
  expect(res.status).toBe(401);
  const events = await db.auditEvent.findMany({
    where: { action: "auth.login_failed", subjectId: "ghost@keel.local" },
  });
  expect(events).toHaveLength(1);
  expect(events[0]?.actorId).toBeNull();
});

test("a malformed body → 400 and no audit event", async () => {
  const before = await db.auditEvent.count();
  expect((await login({ email: "not-an-email" }, "203.0.113.3")).status).toBe(
    400,
  );
  expect((await login("}{ not json", "203.0.113.4")).status).toBe(400);
  expect(await db.auditEvent.count()).toBe(before);
});

test("the per-IP rate limit trips after 10 attempts, and a 429 emits nothing", async () => {
  const ip = "203.0.113.5";
  const email = "nobody@keel.local";
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    statuses.push((await login({ email, password: "secret12" }, ip)).status);
  }

  expect(statuses.slice(0, 10)).toEqual(Array<number>(10).fill(401));
  expect(statuses[10]).toBe(429);

  // 11 requests, 10 credential checks, so 10 events — the throttled one wrote
  // nothing.
  expect(
    await db.auditEvent.count({
      where: { action: "auth.login_failed", subjectId: email },
    }),
  ).toBe(10);

  // Another client is unaffected — the bucket is per key, not global.
  expect(
    (await login({ email, password: "secret12" }, "203.0.113.6")).status,
  ).toBe(401);
});
