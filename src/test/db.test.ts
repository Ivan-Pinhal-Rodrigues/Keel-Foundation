import { PrismaClient } from "@prisma/client";
import { afterAll, expect, test } from "vitest";
import {
  applyMigrationsToNewSchema,
  dropSchema,
  migrateUrlForSchema,
  testSchemaName,
} from "@/test/db";

// Contract test for the harness that Tasks 4-8 and 11 build on. The pure-function
// cases need no database; one live case exercises the create -> migrate -> drop
// round-trip against the running Postgres.

// --- pure-function contract -------------------------------------------------

test("testSchemaName is well-formed and unique per call", () => {
  expect(testSchemaName()).toMatch(/^test_[0-9a-f]{12}$/);
  expect(testSchemaName()).not.toBe(testSchemaName());
});

test("migrateUrlForSchema swaps ?schema= and keeps other params", () => {
  const original = process.env.MIGRATE_DATABASE_URL;
  process.env.MIGRATE_DATABASE_URL =
    "postgresql://u:p@localhost:5432/keel?connection_limit=5&schema=public";
  try {
    const url = migrateUrlForSchema("test_x");
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("schema")).toBe("test_x");
    expect(params.get("connection_limit")).toBe("5");
  } finally {
    process.env.MIGRATE_DATABASE_URL = original;
  }
});

test("applyMigrationsToNewSchema rejects an unsafe schema name", async () => {
  await expect(
    applyMigrationsToNewSchema('a"; DROP SCHEMA public --'),
  ).rejects.toThrow(/unsafe schema name/i);
});

test("dropSchema rejects an unsafe schema name", async () => {
  await expect(dropSchema('a"; DROP SCHEMA public --')).rejects.toThrow(
    /unsafe schema name/i,
  );
});

// --- live round-trip ------------------------------------------------------

let liveSchema: string | undefined;

afterAll(async () => {
  // safety net if the round-trip test throws before its own dropSchema
  if (liveSchema) await dropSchema(liveSchema);
}, 120_000);

test("applyMigrationsToNewSchema migrates a fresh schema, dropSchema removes it", async () => {
  const schema = await applyMigrationsToNewSchema();
  liveSchema = schema;
  expect(schema).toMatch(/^test_[0-9a-f]{12}$/);

  const admin = new PrismaClient({
    datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } },
  });
  try {
    const tables = await admin.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = '_prisma_migrations'`,
      schema,
    );
    expect(tables).toHaveLength(1);

    await dropSchema(schema);
    liveSchema = undefined;

    const schemata = await admin.$queryRawUnsafe<{ schema_name: string }[]>(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      schema,
    );
    expect(schemata).toHaveLength(0);
  } finally {
    await admin.$disconnect();
  }
}, 120_000);
