import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  appUrlForSchema,
  applyMigrationsToNewSchema,
  dropSchema,
} from "@/test/db";

/**
 * plan-1a Task 5 — record-of-fact immutability, proven from the app's own
 * privilege level.
 *
 * `20260903125809_audit_default_privileges` REVOKEs UPDATE / DELETE on
 * `ApprovalDecision` and `PostImplementationReview` from `keel_app` (the
 * restricted runtime role) — the same lock `AuditEvent` has had since
 * `20260901200800_audit_grants` (see `append-only.test.ts`). These tests connect
 * as `keel_app` against a disposable schema carrying the full migration history
 * and assert those rows can be appended and read but never changed or removed,
 * while the sibling mutable tables (`ApprovalRequest` / `ApprovalStep`) keep full
 * DML.
 *
 * `scripts/check-migrations.mjs` asserts the same grant shape on the dev/public
 * DB; this is the guard for every `test_<hex>` schema the migration runs into.
 */

let appDb: PrismaClient; // keel_app — the restricted runtime role
let schema: string;

let stepId = "";
let userId = "";
let changeId = "";

beforeAll(async () => {
  schema = await applyMigrationsToNewSchema();
  appDb = new PrismaClient({
    datasources: { db: { url: appUrlForSchema(schema) } }, // keel_app credentials
  });

  // keel_app has full DML on the mutable tables — seed the FK chains with it.
  const user = await appDb.user.create({
    data: {
      email: "rof@k.local",
      passwordHash: "x",
      displayName: "RoF",
      kind: "INTERNAL",
      hats: ["TECHNICAL_APPROVER"],
    },
  });
  userId = user.id;

  const request = await appDb.approvalRequest.create({
    data: {
      subjectType: "Change",
      subjectId: "chg_rof",
      policyKey: "change.normal",
      createdById: "someone_else",
    },
  });
  const step = await appDb.approvalStep.create({
    data: {
      requestId: request.id,
      order: 1,
      requiredHat: "TECHNICAL_APPROVER",
    },
  });
  stepId = step.id;

  const change = await appDb.change.create({
    data: {
      ref: "CHG-9001",
      title: "RoF fixture",
      changeType: "NORMAL",
      status: "PIR",
      ownerId: user.id,
    },
  });
  changeId = change.id;
}, 120_000);

afterAll(async () => {
  await appDb.$disconnect();
  await dropSchema(schema);
});

test("keel_app CAN append and read ApprovalDecision", async () => {
  const decision = await appDb.approvalDecision.create({
    data: {
      stepId,
      actorId: userId,
      decision: "APPROVED",
      reason: "appended by keel_app",
    },
  });
  const rows = await appDb.approvalDecision.findMany();
  expect(rows.map((r) => r.id)).toContain(decision.id);
});

test("keel_app CANNOT UPDATE or DELETE ApprovalDecision", async () => {
  await expect(
    appDb.$executeRawUnsafe(
      `UPDATE "ApprovalDecision" SET reason = 'tampered' WHERE "stepId" = '${stepId}'`,
    ),
  ).rejects.toThrow(/permission denied/i);
  await expect(
    appDb.$executeRawUnsafe(
      `DELETE FROM "ApprovalDecision" WHERE "stepId" = '${stepId}'`,
    ),
  ).rejects.toThrow(/permission denied/i);
});

test("keel_app CANNOT TRUNCATE ApprovalDecision", async () => {
  await expect(
    appDb.$executeRawUnsafe(`TRUNCATE "ApprovalDecision"`),
  ).rejects.toThrow(/permission denied/i);
});

test("keel_app CAN append and read PostImplementationReview", async () => {
  const pir = await appDb.postImplementationReview.create({
    data: {
      changeId,
      valueRealized: "YES",
      lessons: "went fine",
      reviewedById: userId,
      reviewedAt: new Date(),
    },
  });
  const rows = await appDb.postImplementationReview.findMany();
  expect(rows.map((r) => r.id)).toEqual([pir.id]);
});

test("keel_app CANNOT UPDATE or DELETE PostImplementationReview", async () => {
  await expect(
    appDb.$executeRawUnsafe(
      `UPDATE "PostImplementationReview" SET lessons = 'tampered' WHERE "changeId" = '${changeId}'`,
    ),
  ).rejects.toThrow(/permission denied/i);
  await expect(
    appDb.$executeRawUnsafe(
      `DELETE FROM "PostImplementationReview" WHERE "changeId" = '${changeId}'`,
    ),
  ).rejects.toThrow(/permission denied/i);
});

test("keel_app CANNOT TRUNCATE PostImplementationReview", async () => {
  await expect(
    appDb.$executeRawUnsafe(`TRUNCATE "PostImplementationReview"`),
  ).rejects.toThrow(/permission denied/i);
});

test("regression: the REVOKE is surgical — keel_app keeps full DML on ApprovalRequest / ApprovalStep", async () => {
  await appDb.$executeRawUnsafe(
    `UPDATE "ApprovalStep" SET status = 'APPROVED' WHERE id = '${stepId}'`,
  );
  await appDb.$executeRawUnsafe(
    `UPDATE "ApprovalRequest" SET status = 'APPROVED' WHERE "subjectId" = 'chg_rof'`,
  );
  const rows = await appDb.$queryRawUnsafe<{ status: string }[]>(
    `SELECT status FROM "ApprovalStep" WHERE id = '${stepId}'`,
  );
  expect(rows[0]?.status).toBe("APPROVED");
});
