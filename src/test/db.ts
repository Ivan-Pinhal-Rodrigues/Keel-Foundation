import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll } from "vitest";
import {
  createTestDb,
  dropTestDb,
  migrateUrlForDb,
  testDbName,
} from "@/test/db-admin";

/**
 * Integration-test database harness.
 *
 * Vitest runs test files in parallel (forks pool). Each file gets its own
 * uniquely-named Postgres **database**, cloned from a template that
 * `src/test/global-setup.ts` migrated once for the whole run:
 *
 *     CREATE DATABASE test_<hex> TEMPLATE keel_test_tmpl
 *
 * That is a file copy — milliseconds — where the old harness spawned
 * `prisma migrate deploy` per file (~2.7 s each, ~13 concurrent, flaky). The
 * copy carries the tables, the enums, the sequences *and the table privileges*,
 * so the `keel_app` REVOKEs from `audit_grants` /
 * `audit_default_privileges` are live in every clone (see `db.test.ts`, and
 * `append-only.test.ts` / `record-of-fact.test.ts` which prove it from
 * `keel_app`'s own privilege level).
 *
 * Role: the database is created and connected to as `keel_migrate`
 * (MIGRATE_DATABASE_URL), which owns it, so the per-file client can do
 * everything. `appUrlForDb` is the `keel_app` (restricted runtime role) twin.
 *
 * The mechanics — URL rewriting, the CREATE / DROP DDL and its retry loop —
 * live in `@/test/db-admin`, which imports no vitest and is therefore also
 * usable from `global-setup.ts` (a different process). This module is the
 * vitest-aware half: the per-file lifecycle.
 *
 * Usage (Ruling B — `withTestDb()` returns a getter):
 *
 *   import { withTestDb } from "@/test/db";
 *   const db = withTestDb();                 // registers beforeAll / afterAll
 *   test("...", async () => {
 *     await db().user.create({ ... });       // db() -> the per-file client
 *   });
 *
 * Route handler tests need the app's `@/server/db/client` singleton bound to
 * the same disposable database — see `withRouteTestDb()` in `@/test/route-db`.
 */

export {
  TEMPLATE_DB,
  appUrlForDb,
  createTestDb,
  dropTestDb,
  migrateUrlForDb,
  testDbName,
} from "@/test/db-admin";

/**
 * Register the per-file database lifecycle and return a getter for the client.
 * The getter throws if called before `beforeAll` has run (e.g. at module top
 * level) — it is only valid inside a test or hook.
 */
export function withTestDb(): () => PrismaClient {
  let client: PrismaClient | undefined;
  let dbName: string | undefined;

  beforeAll(async () => {
    // Assign the name before any DDL runs: if `createTestDb` throws part-way,
    // `afterAll` still knows what to drop.
    dbName = testDbName();
    await createTestDb(dbName);
    client = new PrismaClient({
      datasources: { db: { url: migrateUrlForDb(dbName) } },
    });
  }, 120_000);

  afterAll(async () => {
    try {
      await client?.$disconnect();
    } finally {
      if (dbName) await dropTestDb(dbName);
      client = undefined;
      dbName = undefined;
    }
  }, 120_000);

  return () => {
    if (!client) {
      throw new Error(
        "withTestDb(): client used before beforeAll ran — call the getter inside a test, not at module scope.",
      );
    }
    return client;
  };
}
