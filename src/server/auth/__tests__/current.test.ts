import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { getCurrentActor, whoami } from "@/server/auth/current";
import { createSession } from "@/server/auth/session";
import { prisma as db } from "@/server/db/client";
import { applyMigrationsToNewSchema, dropSchema } from "@/test/db";

/**
 * `getCurrentActor()` / `whoami()` resolve the session through the
 * `@/server/db/client` singleton — `getSessionAndUser(token)` with no client
 * argument, because a React Server Component caller has none to pass. That is
 * the same DB seam as `with-request.test.ts` and the route tests: mock the
 * singleton and bind it to a schema this file owns, so the cookie a test sets
 * actually resolves.
 *
 * (The brief sketched `withTestDb()` + `db() as never`, but that only binds the
 * write inside `createSession`; the read inside `resolve()` still goes through
 * the singleton to `?schema=public` and finds nothing. The test cases and the
 * `next/headers` mock below are otherwise verbatim from the brief.)
 */
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
  await applyMigrationsToNewSchema(schema);
}, 180_000);

afterAll(async () => {
  await db.$disconnect();
  await dropSchema(schema);
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
  expect(me).toMatchObject({ id: u.id, displayName: "Casey", email: "ceo@k" });
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
