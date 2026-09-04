import { PrismaClient } from "@prisma/client";
import { expect, test } from "vitest";
import {
  createTestDb,
  dropTestDb,
  migrateUrlForDb,
  testDbName,
} from "@/test/db";

// Contract test for the harness every integration test builds on. The
// pure-function cases need no database; one live case clones the template and
// pins the property the whole Task 11 rework rests on: `CREATE DATABASE …
// TEMPLATE` copies the migrations' *table privileges*, not just their tables.
//
// Nothing here drops a real database. `dropTestDb`'s guards are exercised below
// with names it must refuse; the drop path proper is exercised ~60 times a run
// by `global-setup.ts`'s teardown sweep, which is now the only caller — a
// per-file `DROP DATABASE` storm crashed the cluster (see `db-admin.ts`).

// --- pure-function contract -------------------------------------------------

test("testDbName is well-formed and unique per call", () => {
  expect(testDbName()).toMatch(/^test_[0-9a-f]{12}$/);
  expect(testDbName()).not.toBe(testDbName());
});

test("migrateUrlForDb swaps the database name and keeps other params", () => {
  const original = process.env.MIGRATE_DATABASE_URL;
  process.env.MIGRATE_DATABASE_URL =
    "postgresql://u:p@localhost:5432/keel?connection_limit=7&schema=public";
  try {
    const url = migrateUrlForDb("test_x");
    expect(url.startsWith("postgresql://u:p@localhost:5432/test_x?")).toBe(
      true,
    );
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    // An explicit connection_limit in the base URL wins; the schema is always
    // `public` — that is where `migrate deploy` put everything in the template.
    expect(params.get("connection_limit")).toBe("7");
    expect(params.get("schema")).toBe("public");
  } finally {
    process.env.MIGRATE_DATABASE_URL = original;
  }
});

test("createTestDb rejects an unsafe database name", async () => {
  await expect(createTestDb('a"; DROP DATABASE keel --')).rejects.toThrow(
    /unsafe database name/i,
  );
});

test("dropTestDb rejects an unsafe database name", async () => {
  await expect(dropTestDb('a"; DROP DATABASE keel --')).rejects.toThrow(
    /unsafe database name/i,
  );
});

test("dropTestDb refuses a well-formed name that is not the harness's", async () => {
  // The DROP path is the dangerous one: a bug that reached it with the dev
  // database's name would be unrecoverable.
  await expect(dropTestDb("keel")).rejects.toThrow(/not a harness database/i);
});

// --- live clone -------------------------------------------------------------

const liveDb = testDbName();

test("createTestDb clones the migrated template, privileges included", async () => {
  expect(liveDb).toMatch(/^test_[0-9a-f]{12}$/);
  expect(await createTestDb(liveDb)).toBe(liveDb);

  const clone = new PrismaClient({
    datasources: { db: { url: migrateUrlForDb(liveDb) } },
  });
  try {
    // The full migration history came across with the clone.
    const migrations = await clone.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    expect(Number(migrations[0]?.count ?? 0)).toBeGreaterThan(0);

    // …and so did the privileges. `audit_grants` /
    // `audit_default_privileges` REVOKE UPDATE + DELETE on the record-of-fact
    // tables from keel_app; if `CREATE DATABASE … TEMPLATE` did not copy
    // `pg_class.relacl`, every clone would silently be mutable and
    // `append-only.test.ts` / `record-of-fact.test.ts` would be testing nothing.
    const leaked = await clone.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT DISTINCT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'keel_app'
          AND privilege_type IN ('UPDATE', 'DELETE')
          AND table_schema = 'public'
          AND table_name IN ('AuditEvent', 'ApprovalDecision', 'PostImplementationReview')`,
    );
    expect(leaked).toEqual([]);

    // Positive control: the REVOKE is surgical, and the GRANTs cloned too.
    const mutable = await clone.$queryRawUnsafe<{ privilege_type: string }[]>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'keel_app' AND table_schema = 'public'
          AND table_name = 'User' AND privilege_type IN ('UPDATE', 'DELETE')
        ORDER BY privilege_type`,
    );
    expect(mutable.map((r) => r.privilege_type)).toEqual(["DELETE", "UPDATE"]);
  } finally {
    await clone.$disconnect();
  }

  // The clone is left standing on purpose — `global-setup.ts`'s teardown sweep
  // removes it along with every other test file's.
}, 120_000);
