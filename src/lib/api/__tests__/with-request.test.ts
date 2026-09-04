import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { withRequest } from "@/lib/api/with-request";
import {
  UnauthenticatedError,
  getActor,
  getActorOrNull,
} from "@/server/auth/actor";
import { createSession, getSessionAndUser } from "@/server/auth/session";
import { getRequestId } from "@/server/context";
import { logger } from "@/server/log";
import { prisma as db } from "@/server/db/client";
import { createTestDb, dropTestDb } from "@/test/db";

/**
 * Same seam as the login route test: the wrapper reaches the database through
 * the app singleton (`getSessionAndUser` / `touchSession`), so the singleton
 * module is mocked and bound to a database this file owns. (New route tests
 * should use `withRouteTestDb()` from `@/test/route-db`, which packages this
 * dance — see `guest-invites/__tests__/create.route.test.ts`.)
 */
const { dbName } = await vi.hoisted(async () => {
  const { randomBytes } = await import("node:crypto");
  return { dbName: `test_${randomBytes(6).toString("hex")}` };
});

vi.mock("@/server/db/client", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { migrateUrlForDb } = await import("@/test/db");
  return {
    prisma: new PrismaClient({
      datasources: { db: { url: migrateUrlForDb(dbName) } },
    }),
  };
});

// Wrap `getSessionAndUser` so one test can force a failure mid-resolution and
// assert the wrapper still returns a structured 500. Calls through by default.
vi.mock("@/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session")>();
  return { ...actual, getSessionAndUser: vi.fn(actual.getSessionAndUser) };
});

let userId = "";
let rawToken = "";

beforeAll(async () => {
  await createTestDb(dbName);
  const u = await db.user.create({
    data: {
      email: "dev@keel.local",
      passwordHash: "x",
      displayName: "Dev",
      kind: "INTERNAL",
      hats: ["DEVELOPER", "TECHNICAL_APPROVER"],
    },
  });
  userId = u.id;
  const { token } = await createSession(u.id, {
    ip: "1.2.3.4",
    userAgent: "vitest",
  });
  rawToken = token;
}, 180_000);

afterAll(async () => {
  await db.$disconnect();
  await dropTestDb(dbName);
}, 120_000);

const req = (init?: { cookie?: string; requestId?: string }) => {
  const headers: Record<string, string> = {};
  if (init?.cookie) headers.cookie = init.cookie;
  if (init?.requestId) headers["x-request-id"] = init.requestId;
  return new Request("http://localhost:3000/api/thing", { headers });
};

test("a valid session cookie populates ctx.actor and getActor() returns the same actor", async () => {
  let fromCtx: unknown;
  let fromHelper: unknown;
  const handler = withRequest(async (_r, ctx) => {
    fromCtx = ctx.actor;
    fromHelper = await getActor();
    return Response.json({ ok: true });
  });

  const res = await handler(
    req({ cookie: `authjs.session-token=${rawToken}` }),
  );
  expect(res.status).toBe(200);
  expect(fromCtx).toEqual({
    id: userId,
    kind: "INTERNAL",
    hats: ["DEVELOPER", "TECHNICAL_APPROVER"],
    clientId: null,
  });
  expect(fromHelper).toEqual(fromCtx);
});

test("no cookie → ctx.actor is null, getActorOrNull() is null, getActor() throws UnauthenticatedError", async () => {
  let ctxActor: unknown = "unset";
  let orNull: unknown = "unset";
  let threw: unknown = null;
  const handler = withRequest(async (_r, ctx) => {
    ctxActor = ctx.actor;
    orNull = await getActorOrNull();
    try {
      await getActor();
    } catch (e) {
      threw = e;
    }
    return Response.json({ ok: true });
  });

  await handler(req());
  expect(ctxActor).toBeNull();
  expect(orNull).toBeNull();
  expect(threw).toBeInstanceOf(UnauthenticatedError);
});

test("an invalid/unknown session cookie resolves to a null actor", async () => {
  let ctxActor: unknown = "unset";
  const handler = withRequest(async (_r, ctx) => {
    ctxActor = ctx.actor;
    return Response.json({ ok: true });
  });
  await handler(req({ cookie: "authjs.session-token=not-a-real-token" }));
  expect(ctxActor).toBeNull();
});

test("a cookie value with broken percent-encoding is treated as no cookie — handler still runs, actor null", async () => {
  let ctxActor: unknown = "unset";
  const handler = withRequest(async (_r, ctx) => {
    ctxActor = ctx.actor;
    return Response.json({ ok: true });
  });
  const res = await handler(req({ cookie: "authjs.session-token=%" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(ctxActor).toBeNull();
});

test("a failure during session resolution → structured 500, not an unhandled throw", async () => {
  vi.mocked(getSessionAndUser).mockRejectedValueOnce(new Error("db blip"));
  const spy = vi.spyOn(logger, "error").mockImplementation(() => true as never);

  const handler = withRequest(async () => Response.json({ ok: true }));
  const res = await handler(
    req({ cookie: `authjs.session-token=${rawToken}` }),
  );

  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "internal" });
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});

test("the x-request-id request header becomes the context requestId", async () => {
  let seen = "";
  const handler = withRequest(async (_r, ctx) => {
    seen = ctx.requestId;
    expect(getRequestId()).toBe(ctx.requestId);
    return Response.json({ ok: true });
  });
  await handler(req({ requestId: "rid-fixed-123" }));
  expect(seen).toBe("rid-fixed-123");
});

test("no x-request-id header → the wrapper mints one", async () => {
  let seen = "";
  const handler = withRequest(async (_r, ctx) => {
    seen = ctx.requestId;
    return Response.json({ ok: true });
  });
  await handler(req());
  expect(seen).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});

test("a handler throwing UnauthenticatedError → 401 {error:'unauthenticated'}", async () => {
  const handler = withRequest(async () => {
    throw new UnauthenticatedError("no");
  });
  const res = await handler(req());
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthenticated" });
});

test("a handler throwing a ZodError → 400 {error:'invalid', issues}", async () => {
  const handler = withRequest(async () => {
    z.object({ a: z.string() }).parse({});
    return Response.json({ ok: true });
  });
  const res = await handler(req());
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string; issues: unknown[] };
  expect(body.error).toBe("invalid");
  expect(Array.isArray(body.issues)).toBe(true);
  expect(body.issues.length).toBeGreaterThan(0);
});

test("a handler throwing a generic error → 500 {error:'internal'} and logs it", async () => {
  const spy = vi.spyOn(logger, "error").mockImplementation(() => true as never);
  const handler = withRequest(async () => {
    throw new Error("boom");
  });
  const res = await handler(req());
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "internal" });
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
