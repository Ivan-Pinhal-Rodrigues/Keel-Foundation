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
 * in every clone — and `DROP DATABASE … WITH (FORCE)` on teardown.
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
 * `CREATE DATABASE … TEMPLATE` fails with SQLSTATE 55006 ("source database is
 * being accessed by other users") if anything is connected to the template, and
 * `DROP DATABASE` can hit the same class of transient conflict. ~13 workers
 * reach `beforeAll` at once, so this is a *when*, not an *if*. 53300 ("too many
 * clients") is the other transient failure worth surviving.
 *
 * Everything else is re-thrown immediately — a genuinely broken statement must
 * not spend 8 seconds pretending to be contention.
 */
const RETRYABLE =
  /\b(?:55006|53300)\b|being accessed by other users|too many clients|remaining connection slots/i;

const MAX_ATTEMPTS = 30;

async function execRetrying(sql: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await withAdmin((admin) => admin.$executeRawUnsafe(sql));
      return;
    } catch (err) {
      if (!RETRYABLE.test(String(err))) throw err;
      lastError = err;
      // Jittered so the workers that collided do not collide again in lockstep.
      await sleep(100 + Math.random() * 200);
    }
  }
  throw new Error(
    `gave up after ${MAX_ATTEMPTS} attempts on transient Postgres contention:\n  ${sql}\n${String(lastError)}`,
  );
}

/** Create one disposable database as a copy of the migrated template. */
export async function createTestDb(dbName: string): Promise<string> {
  assertSafeDbName(dbName);
  await execRetrying(`CREATE DATABASE "${dbName}" TEMPLATE "${TEMPLATE_DB}"`);
  return dbName;
}

/** Drop a disposable database. Safe to call more than once. `WITH (FORCE)`
 *  terminates any straggler backend — callers `$disconnect()` first, but a
 *  Prisma pool can outlive the await by a few milliseconds. */
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
  await execRetrying(
    `ALTER DATABASE "${TEMPLATE_DB}" WITH ALLOW_CONNECTIONS false`,
  );
  await withAdmin(async (admin) => {
    await admin.$queryRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      TEMPLATE_DB,
    );
  });
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
