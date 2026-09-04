import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

/**
 * Postgres plumbing for the integration-test harness.
 *
 * This module is deliberately **vitest-free**. It is imported from two very
 * different places:
 *
 *   - `src/test/global-setup.ts` — Vitest's `globalSetup`, which runs once in
 *     the *main* Vitest process, before any worker exists;
 *   - `src/test/db.ts` / `src/test/route-db.ts` — the per-file harness, which
 *     runs inside each forked worker and does import vitest.
 *
 * globalSetup and the workers are separate processes, so nothing can be shared
 * at runtime. Everything they must agree on (the template database name, the
 * `test_` prefix, the URL shape) is a compile-time constant here.
 *
 * The model, in one paragraph: `globalSetup` drops and recreates one template
 * database, runs `prisma migrate deploy` into it once, and blocks further
 * connections to it. Each test file then does
 * `CREATE DATABASE test_<hex> TEMPLATE keel_test_tmpl` — a near-instant file
 * copy that carries the full schema *and its table privileges*, so the
 * `keel_app` REVOKEs from `audit_grants` / `audit_default_privileges` are live
 * in every clone.
 *
 * Two things keep this stable, both of them load-bearing — see `DDL_LOCK_KEY`
 * and `dropTestDb`:
 *
 *   - every `CREATE`/`DROP DATABASE` is serialised cluster-wide behind an
 *     advisory lock, because running them concurrently crashes Postgres;
 *   - nothing drops a clone during the run at all. `globalSetup` owns cleanup
 *     and sweeps at teardown, so every clone coexists for the length of a run —
 *     ~9 MB apiece, ~226 MB peak for the full suite.
 */

const nodeRequire = createRequire(import.meta.url);
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA_PATH = path.join(PROJECT_ROOT, "prisma", "schema.prisma");
// Invoke the Prisma CLI through `node` directly — no shell, no PATH lookup, so
// it behaves the same on Windows dev and Linux CI.
const PRISMA_BIN = nodeRequire.resolve("prisma/build/index.js");

/** The one database the migration history is applied to, once per suite run.
 *  Every `test_<hex>` database is a `CREATE DATABASE … TEMPLATE` copy of it. */
export const TEMPLATE_DB = "keel_test_tmpl";

/** Prefix for the disposable per-file clones. `global-setup` sweeps anything
 *  carrying it, so nothing outside the harness may use it. */
export const TEST_DB_PREFIX = "test_";

/** Per-file clones are short-lived and mostly serial; a small explicit pool
 *  keeps ~13 workers well under postgres's default `max_connections = 100`
 *  (Prisma otherwise defaults to `num_cpus * 2 + 1` per client). */
const TEST_CONNECTION_LIMIT = "5";

/** The admin client runs exactly one statement per open/close cycle. */
const ADMIN_CONNECTION_LIMIT = "1";

function requireEnv(name: "DATABASE_URL" | "MIGRATE_DATABASE_URL"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. vitest.setup.ts (workers) and src/test/global-setup.ts must load dotenv before tests run.`,
    );
  }
  return value;
}

/** `scheme://user:pass@host:port/` + `dbname` + `?query`. Anchored, so a URL
 *  without a database path segment is rejected rather than silently mangled. */
const CONNECTION_URL_RE = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*\/)([^/?#]*)(.*)$/i;

/** Postgres identifiers cannot be bound parameters, so database names are
 *  interpolated into DDL — guard the shape before they ever reach a query. */
function assertSafeDbName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`unsafe database name: ${JSON.stringify(name)}`);
  }
}

/** Stricter guard for the DROP path: the harness may only ever destroy its own
 *  disposable databases, never `keel`. */
function assertDisposableDbName(name: string): void {
  assertSafeDbName(name);
  if (name !== TEMPLATE_DB && !name.startsWith(TEST_DB_PREFIX)) {
    throw new Error(
      `refusing to drop "${name}": not a harness database (expected "${TEMPLATE_DB}" or a "${TEST_DB_PREFIX}*" clone)`,
    );
  }
}

/** Repoint a connection string at another *database*, preserving the role,
 *  host and every other query parameter. (The old harness swapped `?schema=`;
 *  clones are whole databases now, so the path segment moves instead and the
 *  schema is always `public` — that is where `migrate deploy` put everything.) */
function urlForDb(
  baseUrl: string,
  dbName: string,
  connectionLimit: string,
): string {
  const match = CONNECTION_URL_RE.exec(baseUrl);
  if (!match) {
    throw new Error(
      "connection string is not scheme://host/database[?params] — cannot swap the database name",
    );
  }
  // Every group in the pattern is non-optional, so a match fills all three;
  // the defaults are only here to satisfy `noUncheckedIndexedAccess`.
  const [, prefix = "", , rest = ""] = match;
  const q = rest.indexOf("?");
  const params = new URLSearchParams(q === -1 ? "" : rest.slice(q + 1));
  params.set("schema", "public");
  if (!params.has("connection_limit")) {
    params.set("connection_limit", connectionLimit);
  }
  return `${prefix}${dbName}?${params.toString()}`;
}

/** The `keel_migrate` connection string pointed at a specific database.
 *  `appUrlForDb` below is the `keel_app` (restricted runtime role) twin. */
export const migrateUrlForDb = (dbName: string): string =>
  urlForDb(requireEnv("MIGRATE_DATABASE_URL"), dbName, TEST_CONNECTION_LIMIT);

/** The `keel_app` (restricted runtime role) connection string pointed at a
 *  specific database. `append-only.test.ts` / `record-of-fact.test.ts` connect
 *  with this to exercise the audit-log REVOKEs from the app's own privilege
 *  level — those privileges are copied into the clone by `CREATE DATABASE …
 *  TEMPLATE`, which is the whole reason this rework had to be verified. */
export const appUrlForDb = (dbName: string): string =>
  urlForDb(requireEnv("DATABASE_URL"), dbName, TEST_CONNECTION_LIMIT);

/** A collision-free database name for one test file: `test_` + 12 hex chars. */
export const testDbName = (): string =>
  `${TEST_DB_PREFIX}${randomBytes(6).toString("hex")}`;

/** `keel_migrate` on the *stable* database named by `MIGRATE_DATABASE_URL`
 *  (`keel`). CREATE / DROP DATABASE cannot run inside a transaction and cannot
 *  run from the database being touched, so all harness DDL goes through here. */
function adminUrl(): string {
  const base = requireEnv("MIGRATE_DATABASE_URL");
  const match = CONNECTION_URL_RE.exec(base);
  if (!match) {
    throw new Error(
      "MIGRATE_DATABASE_URL is not scheme://host/database[?params]",
    );
  }
  const [, , stableDb = ""] = match;
  if (!stableDb) {
    throw new Error("MIGRATE_DATABASE_URL names no database to connect to");
  }
  return urlForDb(base, stableDb, ADMIN_CONNECTION_LIMIT);
}

/** Open a short-lived `keel_migrate` client on the stable database, run `fn`,
 *  and always disconnect — a lingering session on `keel` is harmless, but a
 *  lingering *pool* across 13 workers is not. */
async function withAdmin<T>(fn: (admin: PrismaClient) => Promise<T>) {
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl() } },
  });
  try {
    return await fn(admin);
  } finally {
    await admin.$disconnect();
  }
}

/**
 * **Concurrent `CREATE DATABASE` / `DROP DATABASE` crashes the cluster**, so
 * every one of them is serialised behind this advisory lock.
 *
 * This was measured, not guessed. With no vitest and no Prisma in the picture,
 * driving plain `psql`:
 *
 *   - 75 `CREATE DATABASE … TEMPLATE` + 75 `DROP DATABASE`, **serially**, from a
 *     template three times the size of ours — fine, ~27 ms each.
 *   - the same work from **13 concurrent** sessions — `server process … exited
 *     with exit code 2`, `terminating connection because of crash of another
 *     server process`, whole-cluster restart into recovery. Reproducible.
 *   - 13 concurrent sessions again, each taking this lock first — fine.
 *
 * ~13 vitest workers reach `beforeAll` together, which is exactly the failing
 * shape. Serialising costs almost nothing: ~26 clones × ~30 ms is under a
 * second across a run that takes fifteen.
 *
 * `lock_timeout` bounds the wait so a wedged holder surfaces as an error rather
 * than a hung `beforeAll`; a crashed holder's session ends and Postgres releases
 * the lock for us.
 */
const DDL_LOCK_KEY = 0x6b65_656c; // "keel"

/**
 * Retryable failures. 55006 is `CREATE DATABASE … TEMPLATE` racing a connection
 * to the template; 53300 is "too many clients"; the recovery-mode family is a
 * cluster that is restarting under us.
 *
 * Retrying across a restart is safe for the two statements this module issues:
 * `DROP DATABASE IF EXISTS` is idempotent, and `createTestDb` drops before it
 * creates. It is never *silent* — see the warning in `execRetrying`.
 *
 * Everything else is re-thrown immediately: a genuinely broken statement must
 * not spend six seconds pretending to be contention.
 */
const RETRYABLE =
  /\b(?:55006|53300|57P03)\b|being accessed by other users|too many clients|remaining connection slots|database system is (?:in recovery mode|starting up|shutting down)|not yet accepting connections|closed the connection|crash of another server process/i;

/** The subset of `RETRYABLE` that means the cluster went down and came back.
 *  Loud, because that is never normal and must not hide behind a retry. */
const CLUSTER_RESTARTED =
  /not yet accepting connections|in recovery mode|closed the connection|crash of another server process/i;

const MAX_ATTEMPTS = 30;

/** Run one DDL statement as `keel_migrate`, serialised cluster-wide and retried
 *  through transient contention. */
async function execRetrying(sql: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await withAdmin(async (admin) => {
        // connection_limit=1, so every statement below is the same session —
        // which is what makes a session-level advisory lock work here.
        await admin.$executeRawUnsafe(`SET lock_timeout = '60s'`);
        // `$executeRaw`, not `$queryRaw`: pg_advisory_lock returns `void`, and
        // Prisma cannot deserialize a void column.
        await admin.$executeRawUnsafe(
          `SELECT pg_advisory_lock(${DDL_LOCK_KEY})`,
        );
        try {
          await admin.$executeRawUnsafe(sql);
        } finally {
          await admin.$executeRawUnsafe(
            `SELECT pg_advisory_unlock(${DDL_LOCK_KEY})`,
          );
        }
      });
      return;
    } catch (err) {
      if (!RETRYABLE.test(String(err))) throw err;
      if (CLUSTER_RESTARTED.test(String(err))) {
        console.warn(
          `[test-db] Postgres went away mid-statement; retrying: ${sql}`,
        );
      }
      lastError = err;
      // Jittered so the workers that collided do not collide again in lockstep.
      await sleep(100 + Math.random() * 200);
    }
  }
  throw new Error(
    `gave up after ${MAX_ATTEMPTS} attempts on transient Postgres contention:\n  ${sql}\n${String(lastError)}`,
  );
}

/**
 * Create one disposable database as a copy of the migrated template.
 *
 * The `DROP … IF EXISTS` first makes the pair retry-safe: if a `CREATE` is
 * killed mid-flight, the retry would otherwise hit `42P04 already exists` and
 * fail hard. On the normal path the database does not exist, and `DROP DATABASE
 * IF EXISTS` returns before it does any work — in particular before the forced
 * checkpoint — so this costs nothing.
 */
export async function createTestDb(dbName: string): Promise<string> {
  assertDisposableDbName(dbName);
  await execRetrying(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await execRetrying(`CREATE DATABASE "${dbName}" TEMPLATE "${TEMPLATE_DB}"`);
  return dbName;
}

/**
 * Drop a disposable database. Safe to call more than once. `WITH (FORCE)`
 * terminates any straggler backend — callers `$disconnect()` first, but a
 * Prisma pool can outlive the await by a few milliseconds.
 *
 * **Call this from `global-setup.ts` only.** `DROP DATABASE` unconditionally
 * requests `CHECKPOINT_IMMEDIATE | FORCE | WAIT`, and that is inherent to the
 * statement, not to `WITH (FORCE)`. Keeping all of them in one place, after
 * every worker has exited, keeps that cost off the run's critical path — and
 * the advisory lock in `execRetrying` is what keeps it from crashing the
 * cluster when it does overlap something.
 */
export async function dropTestDb(dbName: string): Promise<void> {
  assertDisposableDbName(dbName);
  await execRetrying(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
}

/** Every database this harness owns that currently exists. */
export async function listHarnessDbs(): Promise<string[]> {
  return withAdmin(async (admin) => {
    const rows = await admin.$queryRawUnsafe<{ datname: string }[]>(
      `SELECT datname FROM pg_database
        WHERE datname LIKE 'test\\_%' OR datname = $1
        ORDER BY datname`,
      TEMPLATE_DB,
    );
    return rows.map((r) => r.datname);
  });
}

/** Create the template database, empty. */
export async function createTemplateDb(): Promise<void> {
  await execRetrying(`CREATE DATABASE "${TEMPLATE_DB}"`);
}

/** Block new connections to the template and terminate any straggler, so the
 *  `CREATE DATABASE … TEMPLATE` in every worker cannot trip 55006. `datallowconn`
 *  is *not* inherited by a clone (same as `template0`), and it does not stop the
 *  database being used as a template. */
export async function sealTemplateDb(): Promise<void> {
  // Block new connections first, then clear the ones already in.
  await execRetrying(
    `ALTER DATABASE "${TEMPLATE_DB}" WITH ALLOW_CONNECTIONS false`,
  );
  try {
    await withAdmin(async (admin) => {
      await admin.$queryRawUnsafe(
        // Only our own client sessions. An autovacuum worker can be inside a
        // just-created database, it runs as the bootstrap superuser, and
        // `keel_migrate` may not signal a superuser's backend — trying to
        // failed the whole run with 42501. It is also not worth killing: the
        // launcher skips `datallowconn = false` databases, so the ALTER above
        // means no new one arrives and the current one finishes in
        // milliseconds on a database this small.
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = $1
            AND pid <> pg_backend_pid()
            AND backend_type = 'client backend'
            AND usename = current_user`,
        TEMPLATE_DB,
      );
    });
  } catch {
    // Best effort. This only shortens the window in which a `CREATE DATABASE …
    // TEMPLATE` would bounce off 55006; `execRetrying` is what actually
    // guarantees the clone eventually happens.
  }
}

/** `prisma migrate deploy` into one database, as `keel_migrate`. The only
 *  migrate invocation in a suite run — it used to be one per test file. */
export function deployMigrationsToDb(dbName: string): void {
  assertSafeDbName(dbName);
  const url = migrateUrlForDb(dbName);
  try {
    execFileSync(
      process.execPath,
      [PRISMA_BIN, "migrate", "deploy", "--schema", SCHEMA_PATH],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          // migrate deploy connects via directUrl; set both so there is no
          // ambiguity about which role / database the CLI touches.
          DATABASE_URL: url,
          MIGRATE_DATABASE_URL: url,
          // Nothing else is deploying concurrently any more, but the
          // cross-deployment advisory lock still buys nothing here.
          PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1",
          PRISMA_HIDE_UPDATE_MESSAGE: "1",
        },
        stdio: "pipe",
      },
    );
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    throw new Error(
      `prisma migrate deploy failed for database "${dbName}":\n${
        e.stdout?.toString() ?? ""
      }\n${e.stderr?.toString() ?? ""}\n${e.message ?? ""}`,
    );
  }
}
