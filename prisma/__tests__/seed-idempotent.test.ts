import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestDb, migrateUrlForDb, testDbName } from "@/test/db-admin";

/**
 * Seed idempotency (spec §8's one remaining automated test-plan item).
 *
 * `prisma/seed.ts`'s `main()` is built on `upsert` for every fixture keyed on
 * a unique column, plus an explicit row-count guard in `seedDemoNotifications`
 * -- so running it twice against the same database should be a no-op the
 * second time. This test proves that for real, against a live disposable
 * database (the same per-file-clone-of-a-migrated-template harness every
 * other integration test in this repo uses -- see `src/test/db-admin.ts`),
 * rather than relying on the manual double-run this plan's Task 4 did once by
 * hand.
 *
 * `main()` is exported (and the module's bottom-of-file auto-run guarded by
 * an entry-point check) specifically so this test can import and call it
 * directly, rather than spawning `pnpm seed` as a subprocess against whatever
 * `DATABASE_URL` happens to be live in the shell -- no other test in this
 * repo shells out to a script, and the direct-call approach lets this test
 * target its own isolated database the same way every other integration test
 * does. `main()` opens its own `PrismaClient`, which reads `DATABASE_URL` at
 * construction time (`prisma/schema.prisma`'s `datasource` block), so
 * `DATABASE_URL` is pointed at this file's clone before the module is
 * dynamically imported.
 */

let db: PrismaClient;
let seedMain: () => Promise<void>;
let previousDatabaseUrl: string | undefined;

beforeAll(async () => {
  const dbName = testDbName();
  await createTestDb(dbName);
  const url = migrateUrlForDb(dbName);

  db = new PrismaClient({ datasources: { db: { url } } });

  // `PrismaClient` resolves `env("DATABASE_URL")` lazily, on its first query
  // (the engine connects on demand) -- not eagerly at construction. So this
  // override must stay in place for as long as `seedMain()` might still run a
  // query, not just for the `import()` call itself; it is restored in
  // `afterAll`, once both calls in the test below have completed.
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  ({ main: seedMain } = await import("../seed"));
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

async function counts() {
  const [user, client, demand, incident, change, notification, emailOutbox] =
    await Promise.all([
      db.user.count(),
      db.client.count(),
      db.demand.count(),
      db.incident.count(),
      db.change.count(),
      db.notification.count(),
      db.emailOutbox.count(),
    ]);
  return {
    user,
    client,
    demand,
    incident,
    change,
    notification,
    emailOutbox,
  };
}

test("running the seed twice leaves every row count unchanged", async () => {
  await seedMain();
  const first = await counts();

  // A run that wrote nothing would make the equality check below vacuous --
  // confirm the seed actually populated the database first.
  expect(first.user).toBeGreaterThan(0);
  expect(first.client).toBeGreaterThan(0);
  expect(first.demand).toBeGreaterThan(0);
  expect(first.incident).toBeGreaterThan(0);
  expect(first.change).toBeGreaterThan(0);
  expect(first.notification).toBeGreaterThan(0);
  expect(first.emailOutbox).toBeGreaterThan(0);

  await seedMain();
  const second = await counts();

  expect(second).toEqual(first);
}, 60_000);
