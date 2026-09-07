import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { runWithContext } from "@/server/context";
import { recentEvents } from "@/server/audit/read";
import { writeAudit } from "@/server/audit/write";

const db = withTestDb();

test("recentEvents(5): newest-first, limited to 5, each carrying a non-empty label", async () => {
  for (let i = 0; i < 7; i++) {
    await runWithContext({ requestId: `r-${i}` }, () =>
      writeAudit(db(), {
        actorId: i % 2 === 0 ? `u-${i}` : null,
        action: "demand.create",
        subjectType: "Demand",
        subjectId: `d-${i}`,
        payload: {},
      }),
    );
  }
  // Pin deterministic timestamps for the ordering assertion (the writes above
  // land within the same millisecond under load). keel_migrate owns the table.
  for (let i = 0; i < 7; i++) {
    await db().auditEvent.updateMany({
      where: { subjectId: `d-${i}` },
      data: { at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) },
    });
  }

  const rows = await recentEvents(5, db());

  expect(rows).toHaveLength(5);
  expect(rows.map((r) => r.subjectId)).toEqual([
    "d-6",
    "d-5",
    "d-4",
    "d-3",
    "d-2",
  ]);
  for (const r of rows) {
    expect(r.label).toBe("Demand raised");
    expect(r.action).toBe("demand.create");
    expect(typeof r.at).toBe("string");
  }
  expect(rows[0]!.at).toBe(
    new Date(Date.UTC(2026, 0, 1, 0, 0, 6)).toISOString(),
  );
  expect(rows[0]!.actorId).toBe("u-6");
  expect(rows[1]!.actorId).toBeNull();
});
