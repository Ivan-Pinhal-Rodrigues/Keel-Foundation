import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";

const db = withTestDb();

test("should round-trip timestamps without offset drift through timestamptz columns", async () => {
  // Create a user
  const user = await db().user.create({
    data: {
      email: "test@example.com",
      passwordHash: "hash",
      kind: "INTERNAL",
      displayName: "Test User",
    },
  });

  // Create a demand with explicit timestamp
  const testDate = new Date("2026-03-01T12:00:00Z");
  const demand = await db().demand.create({
    data: {
      ref: "DEM-0001",
      title: "Test Demand",
      problem: "Test problem",
      source: "INTERNAL",
      status: "SUBMITTED",
      submittedById: user.id,
      decidedAt: testDate,
    },
  });

  // Read it back
  const retrieved = await db().demand.findUniqueOrThrow({
    where: { id: demand.id },
  });

  // Verify timestamp matches exactly (no offset drift)
  expect(retrieved.decidedAt?.getTime()).toBe(testDate.getTime());
});

test("should verify column types are timestamptz in information_schema", async () => {
  // Query two tables for their column types
  interface ColumnInfo {
    table_name: string;
    column_name: string;
    data_type: string;
  }
  const result = await db().$queryRaw<ColumnInfo[]>`
    SELECT DISTINCT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'Incident'
          AND column_name IN ('createdAt', 'dueAt', 'updatedAt'))
        OR (table_name = 'Demand'
          AND column_name IN ('createdAt', 'decidedAt', 'updatedAt'))
      )
    ORDER BY table_name, column_name
  `;

  // All returned columns should be timestamptz
  expect(result.length).toBeGreaterThanOrEqual(6);
  result.forEach((row: ColumnInfo) => {
    expect(row.data_type).toBe("timestamp with time zone");
  });

  // Specifically check that we have the expected columns
  const columnSet = new Set(
    result.map((r: ColumnInfo) => `${r.table_name}.${r.column_name}`),
  );
  expect(columnSet.has("Incident.createdAt")).toBe(true);
  expect(columnSet.has("Incident.dueAt")).toBe(true);
  expect(columnSet.has("Demand.createdAt")).toBe(true);
  expect(columnSet.has("Demand.decidedAt")).toBe(true);
});
