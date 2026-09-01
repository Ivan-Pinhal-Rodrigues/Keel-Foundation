import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  applyMigrationsToNewSchema,
  appUrlForSchema,
  dropSchema,
} from "@/test/db";

/**
 * Task 7 — audit-log immutability, proven from the app's own privilege level.
 *
 * The `audit_grants` migration gives `keel_app` (the restricted runtime role)
 * full DML on every table in the schema it runs against, then REVOKEs UPDATE and
 * DELETE on "AuditEvent". These tests connect as keel_app — not keel_migrate,
 * which owns the schema and could never be constrained this way — against a
 * disposable schema carrying the full migration history, and assert an audit row
 * can be written once and thereafter neither changed nor removed.
 */

let appDb: PrismaClient;
let schema: string;

beforeAll(async () => {
  schema = await applyMigrationsToNewSchema(); // keel_migrate: CREATE + migrate
  appDb = new PrismaClient({
    datasources: { db: { url: appUrlForSchema(schema) } }, // keel_app credentials
  });
}, 120_000);

afterAll(async () => {
  await appDb.$disconnect();
  await dropSchema(schema);
});

test("keel_app CAN INSERT and SELECT AuditEvent", async () => {
  await appDb.$executeRawUnsafe(
    `INSERT INTO "AuditEvent" (id, action, "subjectType", "subjectId", "requestId")
     VALUES ('a1', 'x.y', 'Demand', 'd1', 'r1')`,
  );
  const rows = await appDb.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "AuditEvent"`,
  );
  expect(rows).toHaveLength(1);
});

test("keel_app CANNOT UPDATE or DELETE AuditEvent", async () => {
  await expect(
    appDb.$executeRawUnsafe(
      `UPDATE "AuditEvent" SET action = 'z' WHERE id = 'a1'`,
    ),
  ).rejects.toThrow(/permission denied/i);
  await expect(
    appDb.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE id = 'a1'`),
  ).rejects.toThrow(/permission denied/i);
});

test("keel_app CANNOT TRUNCATE AuditEvent", async () => {
  await expect(
    appDb.$executeRawUnsafe(`TRUNCATE "AuditEvent"`),
  ).rejects.toThrow(/permission denied/i);
});

test("regression: keel_app CAN INSERT / UPDATE / DELETE a non-audit table", async () => {
  // The audit-log REVOKE must be surgical: every other table keeps full DML.
  // "User"."updatedAt" is NOT NULL with no DB default (Prisma sets it in the
  // client layer), so a raw INSERT has to supply it.
  await appDb.$executeRawUnsafe(
    `INSERT INTO "User" (id, email, "passwordHash", "displayName", kind, hats, "updatedAt")
     VALUES ('u1', 'a@b.c', 'x', 'A', 'INTERNAL', '{}', now())`,
  );
  await appDb.$executeRawUnsafe(
    `UPDATE "User" SET "displayName" = 'A2' WHERE id = 'u1'`,
  );
  await appDb.$executeRawUnsafe(`DELETE FROM "User" WHERE id = 'u1'`);
  const rows = await appDb.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "User"`,
  );
  expect(rows).toHaveLength(0);
});
