import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { getCurrentActor, whoami } from "@/server/auth/current";
import { createSession } from "@/server/auth/session";
import { prisma as db } from "@/server/db/client";
import { createTestDb } from "@/test/db";

/**
 * `getCurrentActor()` / `whoami()` resolve the session through the
 * `@/server/db/client` singleton — `getSessionAndUser(token)` with no client
 * argument, because a React Server Component caller has none to pass. That is
 * the same DB seam as `with-request.test.ts` and the route tests: mock the
 * singleton and bind it to a database this file owns, so the cookie a test sets
 * actually resolves. (New route tests should use `withRouteTestDb()` from
 * `@/test/route-db`, which packages this dance — see
 * `app/api/guest-invites/__tests__/create.route.test.ts`.)
 *
 * (The brief sketched `withTestDb()` + `db() as never`, but that only binds the
 * write inside `createSession`; the read inside `resolve()` still goes through
 * the singleton to the dev database and finds nothing. The test cases and the
 * `next/headers` mock below are otherwise verbatim from the brief.)
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

const cookieStore = { value: undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) =>
      n === "authjs.session-token" && cookieStore.value
        ? { value: cookieStore.value }
        : undefined,
  }),
}));

beforeAll(async () => {
  await createTestDb(dbName);
}, 180_000);

// Disconnect only — `global-setup.ts` sweeps the clone. See `withTestDb()`.
afterAll(async () => {
  await db.$disconnect();
}, 120_000);

afterEach(() => {
  cookieStore.value = undefined;
});

test("no cookie → null", async () => {
  expect(await getCurrentActor()).toBeNull();
  expect(await whoami()).toBeNull();
});

test("a live session cookie → the Actor and Me", async () => {
  const u = await db.user.create({
    data: {
      email: "ceo@k",
      passwordHash: "x",
      displayName: "Casey",
      kind: "INTERNAL",
      hats: ["BUSINESS_APPROVER"],
    },
  });
  const { token } = await createSession(u.id);
  cookieStore.value = token;

  const actor = await getCurrentActor();
  expect(actor).toMatchObject({
    id: u.id,
    kind: "INTERNAL",
    hats: ["BUSINESS_APPROVER"],
    clientId: null,
  });
  const me = await whoami();
  expect(me).toMatchObject({
    id: u.id,
    displayName: "Casey",
    email: "ceo@k",
    clientName: null,
  });
});

test("a guest's Me carries the client org name", async () => {
  const client = await db.client.create({
    data: { name: "Northwind Traders" },
  });
  const g = await db.user.create({
    data: {
      email: "guest@northwind",
      passwordHash: "x",
      displayName: "Nadia",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  const { token } = await createSession(g.id);
  cookieStore.value = token;

  const me = await whoami();
  expect(me).toMatchObject({
    id: g.id,
    clientId: client.id,
    clientName: "Northwind Traders",
  });
});

test("an expired / unknown token → null (not a throw)", async () => {
  cookieStore.value = "deadbeef";
  expect(await getCurrentActor()).toBeNull();
});

test("a deactivated user's live token → null", async () => {
  const u = await db.user.create({
    data: {
      email: "x@k",
      passwordHash: "x",
      displayName: "X",
      kind: "INTERNAL",
      hats: [],
      isActive: false,
    },
  });
  const { token } = await createSession(u.id);
  cookieStore.value = token;
  expect(await getCurrentActor()).toBeNull();
});
