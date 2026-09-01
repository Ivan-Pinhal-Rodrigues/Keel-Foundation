import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { runWithContext } from "@/server/context";
import { writeAudit } from "@/server/audit/write";

const db = withTestDb();

test("writeAudit inserts one row with the context requestId", async () => {
  await runWithContext({ requestId: "req-9" }, async () => {
    await writeAudit(db(), {
      actorId: "u1",
      action: "demand.create",
      subjectType: "Demand",
      subjectId: "d1",
      payload: { title: "x" },
    });
  });
  const rows = await db().auditEvent.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: "demand.create",
    requestId: "req-9",
    actorId: "u1",
  });
});

test("writeAudit throws when called outside a request context", async () => {
  await expect(
    writeAudit(db(), {
      actorId: null,
      action: "x",
      subjectType: "y",
      subjectId: "z",
    }),
  ).rejects.toThrow(/request context/i);
});

test("writeAudit with payload omitted stores no payload and sets `at` to a Date", async () => {
  await runWithContext({ requestId: "req-np" }, async () => {
    await writeAudit(db(), {
      actorId: null,
      action: "system.tick",
      subjectType: "Job",
      subjectId: "j1",
    });
  });
  const rows = await db().auditEvent.findMany({
    where: { requestId: "req-np" },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]!.payload).toBeNull();
  expect(rows[0]!.at).toBeInstanceOf(Date);
});
