import { config } from "dotenv";
import {
  TEMPLATE_DB,
  createTemplateDb,
  deployMigrationsToDb,
  dropTestDb,
  listHarnessDbs,
  sealTemplateDb,
} from "@/test/db-admin";

/**
 * Vitest `globalSetup` — runs once per suite run, in the main Vitest process,
 * before any worker forks.
 *
 * It builds the template database every test file clones: drop whatever a
 * previous run left behind, `CREATE DATABASE keel_test_tmpl`, run the full
 * migration history into it exactly once, then seal it (no further connections)
 * so `CREATE DATABASE … TEMPLATE` in the workers cannot trip SQLSTATE 55006.
 *
 * This replaces one `prisma migrate deploy` *per test file* (~2.7 s and a
 * process spawn each, ~13 of them concurrent, flaky at that concurrency).
 *
 * Two things this file must get right:
 *
 *  1. **Zero connections to the template when it returns.** `migrate deploy`
 *     runs in a child process that exits; `sealTemplateDb()` then blocks new
 *     connections and terminates any straggler.
 *  2. **Self-healing.** A hard-killed run (Ctrl-C, a crashed worker) never runs
 *     teardown, so the sweep at the *start* is what actually guarantees a clean
 *     cluster — not the one at the end.
 *
 * The teardown sweep is also the *only* place a `test_<hex>` clone is dropped on
 * the happy path. Test files no longer drop their own: `DROP DATABASE` forces an
 * immediate checkpoint, and ~26 of those belong off the run's critical path.
 * The cost is that every clone coexists for the length of a run — ~9 MB each,
 * ~226 MB peak for the full suite.
 *
 * `setupFiles` (vitest.setup.ts) only run inside workers, so dotenv is loaded
 * here as well; `db-admin.ts` is deliberately vitest-free so it can be imported
 * from this process.
 */

/** Drop the template and every `test_*` clone. Returns what it removed. */
async function sweep(): Promise<string[]> {
  const found = await listHarnessDbs();
  for (const name of found) await dropTestDb(name);
  return found;
}

export default async function setup(): Promise<() => Promise<void>> {
  config({ quiet: true });

  const started = Date.now();
  const leftovers = await sweep();
  if (leftovers.length > 0) {
    console.warn(
      `[test-db] swept ${leftovers.length} database(s) left by an earlier run: ${leftovers.join(", ")}`,
    );
  }

  await createTemplateDb();
  try {
    deployMigrationsToDb(TEMPLATE_DB);
    await sealTemplateDb();
  } catch (err) {
    // Never leave a half-migrated template behind for the workers to clone —
    // but a failure to clean up must not mask why the migrate failed.
    try {
      await dropTestDb(TEMPLATE_DB);
    } catch {
      /* the original error below is the one worth reading */
    }
    throw err;
  }
  console.log(
    `[test-db] template "${TEMPLATE_DB}" migrated in ${Date.now() - started} ms`,
  );

  return async function teardown(): Promise<void> {
    // The normal path: every clone each test file created is still here, and
    // this is where they go. Serial, with every worker already gone, so the
    // forced checkpoint each DROP DATABASE triggers never overlaps another.
    const swept = Date.now();
    const removed = await sweep();
    console.log(
      `[test-db] dropped ${removed.length} database(s) in ${Date.now() - swept} ms`,
    );
  };
}
