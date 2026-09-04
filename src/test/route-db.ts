import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll } from "vitest";
import { SESSION_COOKIE } from "@/lib/http/cookies";
import { runWithContext } from "@/server/context";
import type { Actor } from "@/server/policy/actor";
import {
  createTestDb,
  dropTestDb,
  migrateUrlForDb,
  testDbName,
} from "@/test/db-admin";

/**
 * Route-handler test harness — the mock-and-lifecycle dance six Phase 0 route
 * tests were each copy-pasting, in one place.
 *
 * A route handler may not import a Prisma client (eslint `no-restricted-imports`
 * — DESIGN.md §3.2), so it reaches the database through the `@/server/db/client`
 * singleton. To point a route test at a disposable database, that *module* has
 * to be mocked. The whole request path — `withRequest`'s session resolution,
 * `runInTransaction`, the handler's own writes — then resolves to the same
 * mocked module, and the test can import it too, to seed and assert.
 *
 * ## The seam, and why it is still a couple of lines in the test file
 *
 * `vi.mock` is hoisted by Vitest's transform above every import, so it cannot be
 * moved inside a helper call — and it cannot even *name* an imported helper:
 * `vi.mock("@/server/db/client", routeDbClientMock)` dies with
 * `Cannot access '__vi_import_1__' before initialization`, because the hoisted
 * statement runs before the import that binds it. The factory must therefore be
 * self-contained, reaching this module by dynamic import at call time. What can
 * be hidden is everything the factory *does*. A route test reads:
 *
 *     vi.mock("@/server/db/client", async () =>
 *       (await import("@/test/route-db")).routeDbClientMock(),
 *     );
 *     const { db, asActor } = withRouteTestDb();
 *
 * — replacing ~25 lines of per-file `vi.hoisted` name minting, an inline
 * PrismaClient factory, and a `beforeAll` / `afterAll` pair.
 *
 * ## How the two halves agree on a database name
 *
 * They share this module. `DB_NAME` is minted once at module load and read by
 * both the mock factory (whenever the mocked module is first imported) and
 * `withRouteTestDb()` (at the test file's top level). Vitest isolates the module
 * graph per test file (`isolate: true`, the default), so each file gets its own
 * `route-db` instance and therefore its own database. That is also why the old
 * `vi.hoisted` block minting a name per file is no longer needed.
 *
 * ## Import hygiene
 *
 * Nothing above may reach `@/server/db/client`, or the mock factory would import
 * a module that is mid-construction. `@/lib/http/cookies` and
 * `@/server/policy/actor` are zero-import leaves and `@/server/context` only
 * touches `node:async_hooks`; `@/server/auth/session` *does* reach the singleton,
 * so `asActor` imports it dynamically, after the mock is established.
 */

/** One database per test file, minted at module load so the `vi.mock` factory
 *  and `withRouteTestDb()` — which run at different times — see the same name. */
const DB_NAME = testDbName();

let client: PrismaClient | undefined;

/** The per-file client, bound to `DB_NAME`. Constructing a PrismaClient opens
 *  no connection, so this is safe to call before the database exists. */
function routeDbClient(): PrismaClient {
  client ??= new PrismaClient({
    datasources: { db: { url: migrateUrlForDb(DB_NAME) } },
  });
  return client;
}

/**
 * The mocked shape of `@/server/db/client`. Call it from a self-contained
 * `vi.mock` factory (see the module comment for why it cannot be passed by
 * reference).
 */
export const routeDbClientMock = (): { prisma: PrismaClient } => ({
  prisma: routeDbClient(),
});

/** A signed-in user, ready to be handed to a route handler. */
export type TestActor = {
  userId: string;
  /** The raw session token. The `Session` row stores its SHA-256, never this. */
  token: string;
  /** A ready-made `cookie:` header value carrying that token. */
  cookie: string;
  /** Spread into a `Request` init's `headers`. */
  headers: { cookie: string };
  /** The `Actor` `withRequest` would resolve for this user. */
  actor: Actor;
  /**
   * Run `fn` inside a request context that already names this actor — for
   * service-level code called directly rather than through `withRequest`
   * (which opens its own context from the cookie). Nesting is harmless.
   */
  run<T>(fn: () => Promise<T> | T): Promise<T>;
};

/**
 * Mint a real `Session` row for `user` and return the cookie + context stubs a
 * route test needs. `user` may be an id or anything with one.
 */
export async function asActor(
  user: string | { id: string },
  meta?: { ip?: string; userAgent?: string },
): Promise<TestActor> {
  const userId = typeof user === "string" ? user : user.id;
  const db = routeDbClient();

  // Dynamic: `session.ts` imports the singleton this module's factory mocks.
  const { createSession } = await import("@/server/auth/session");
  const { token } = await createSession(userId, {
    ip: meta?.ip ?? "10.0.0.1",
    userAgent: meta?.userAgent ?? "vitest",
  });

  const row = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, kind: true, hats: true, clientId: true },
  });
  const actor: Actor = {
    id: row.id,
    kind: row.kind,
    hats: row.hats,
    clientId: row.clientId,
  };

  const cookie = `${SESSION_COOKIE}=${token}`;
  return {
    userId,
    token,
    cookie,
    headers: { cookie },
    actor,
    run: <T>(fn: () => Promise<T> | T) =>
      runWithContext(
        { requestId: randomUUID(), actorId: userId, actor },
        async () => fn(),
      ),
  };
}

/**
 * Register the per-file database lifecycle for a route test and hand back the
 * client the mocked singleton is bound to. Pair with
 * `vi.mock("@/server/db/client", routeDbClientMock)`.
 */
export function withRouteTestDb(): {
  db: PrismaClient;
  asActor: typeof asActor;
} {
  const db = routeDbClient();

  beforeAll(async () => {
    await createTestDb(DB_NAME);
  }, 180_000);

  afterAll(async () => {
    try {
      await db.$disconnect();
    } finally {
      await dropTestDb(DB_NAME);
    }
  }, 120_000);

  return { db, asActor };
}
