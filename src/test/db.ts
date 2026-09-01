import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll } from "vitest";

/**
 * Integration-test database harness.
 *
 * Vitest runs test files in parallel (forks pool). Each file gets its own
 * uniquely-named Postgres schema so parallel files never see each other's rows.
 * The full migration history is applied into that schema, a PrismaClient is
 * bound to it, and the schema is dropped on teardown.
 *
 * Role: the schema is created and connected to as `keel_migrate`
 * (MIGRATE_DATABASE_URL). keel_migrate owns the schema, so the per-file client
 * can do everything. The audit-log grant migration is schema-aware
 * (`current_schema()`), so it also runs into every `test_*` schema — but it only
 * GRANTs/REVOKEs for `keel_app`, so the keel_migrate-owned per-file client is
 * unaffected. `appUrlForSchema` (below) is the keel_app-scoped connection string
 * Task 7's append-only test uses to exercise that restriction.
 *
 * Usage (Ruling B — `withTestDb()` returns a getter):
 *
 *   import { withTestDb } from "@/test/db";
 *   const db = withTestDb();                 // registers beforeAll / afterAll
 *   test("...", async () => {
 *     await db().user.create({ ... });       // db() -> the per-file client
 *   });
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

function requireEnv(name: "DATABASE_URL" | "MIGRATE_DATABASE_URL"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. vitest.setup.ts must import "dotenv/config" before tests run.`,
    );
  }
  return value;
}

/** Postgres identifiers cannot be bound parameters, so schema names are
 *  interpolated into DDL — guard the shape before they ever reach a query. */
function assertSafeSchemaName(schema: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) {
    throw new Error(`unsafe schema name: ${JSON.stringify(schema)}`);
  }
}

/** Rewrite the `?schema=` of a connection string, preserving every other param. */
function urlForSchema(baseUrl: string, schema: string): string {
  const q = baseUrl.indexOf("?");
  const origin = q === -1 ? baseUrl : baseUrl.slice(0, q);
  const params = new URLSearchParams(q === -1 ? "" : baseUrl.slice(q + 1));
  params.set("schema", schema);
  return `${origin}?${params.toString()}`;
}

/** The `keel_migrate` connection string pointed at a specific schema.
 *  `appUrlForSchema` below is the `keel_app` (restricted runtime role) twin. */
export const migrateUrlForSchema = (schema: string): string =>
  urlForSchema(requireEnv("MIGRATE_DATABASE_URL"), schema);

/** The `keel_app` (restricted runtime role) connection string pointed at a
 *  specific schema. Task 7's append-only test connects with this to exercise the
 *  audit-log grant restriction from the app's own privilege level. */
export const appUrlForSchema = (schema: string): string =>
  urlForSchema(requireEnv("DATABASE_URL"), schema);

/** A collision-free schema name for one test file: `test_` + 12 hex chars. */
export const testSchemaName = (): string =>
  `test_${randomBytes(6).toString("hex")}`;

/** Run one statement as `keel_migrate` on the base (public) schema — used for
 *  the CREATE / DROP SCHEMA DDL that sits outside any single test schema. */
async function runAsMigrate(sql: string): Promise<void> {
  const admin = new PrismaClient({
    datasources: { db: { url: requireEnv("MIGRATE_DATABASE_URL") } },
  });
  try {
    await admin.$executeRawUnsafe(sql);
  } finally {
    await admin.$disconnect();
  }
}

/** `prisma migrate deploy` into one named schema, as `keel_migrate`. */
function deployMigrations(schema: string): void {
  const url = migrateUrlForSchema(schema);
  try {
    execFileSync(
      process.execPath,
      [PRISMA_BIN, "migrate", "deploy", "--schema", SCHEMA_PATH],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          // migrate deploy connects via directUrl; set both so there is no
          // ambiguity about which role / schema the CLI touches.
          DATABASE_URL: url,
          MIGRATE_DATABASE_URL: url,
          // Each test file owns a disjoint schema, so the cross-deployment
          // advisory lock is pure contention — disable it for real parallelism.
          PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1",
          PRISMA_HIDE_UPDATE_MESSAGE: "1",
        },
        stdio: "pipe",
      },
    );
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    throw new Error(
      `prisma migrate deploy failed for schema "${schema}":\n${
        e.stdout?.toString() ?? ""
      }\n${e.stderr?.toString() ?? ""}\n${e.message ?? ""}`,
    );
  }
}

/**
 * Create a fresh uniquely-named schema and apply the full migration history to
 * it. Returns the schema name. Pass an explicit name to target a known schema.
 * (Task 7's append-only test calls this with no argument.)
 */
export async function applyMigrationsToNewSchema(
  schema: string = testSchemaName(),
): Promise<string> {
  assertSafeSchemaName(schema);
  await runAsMigrate(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  deployMigrations(schema);
  return schema;
}

/** Drop a test schema and everything in it. Safe to call more than once. */
export async function dropSchema(schema: string): Promise<void> {
  assertSafeSchemaName(schema);
  await runAsMigrate(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

/**
 * Register the per-file schema lifecycle and return a getter for the client.
 * The getter throws if called before `beforeAll` has run (e.g. at module top
 * level) — it is only valid inside a test or hook.
 */
export function withTestDb(): () => PrismaClient {
  let client: PrismaClient | undefined;
  let schema: string | undefined;

  beforeAll(async () => {
    // Assign the name before any DDL runs: if `applyMigrationsToNewSchema`
    // throws after `CREATE SCHEMA`, `afterAll` still knows what to drop.
    schema = testSchemaName();
    await applyMigrationsToNewSchema(schema);
    client = new PrismaClient({
      datasources: { db: { url: migrateUrlForSchema(schema) } },
    });
  }, 120_000);

  afterAll(async () => {
    try {
      await client?.$disconnect();
    } finally {
      if (schema) await dropSchema(schema);
      client = undefined;
      schema = undefined;
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
