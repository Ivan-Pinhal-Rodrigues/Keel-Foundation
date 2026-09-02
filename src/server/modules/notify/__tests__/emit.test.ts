import { randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import type { $Enums } from "@prisma/client";
import { withTestDb } from "@/test/db";
import { emitNotification } from "@/server/modules/notify/emit";

const db = withTestDb();

/**
 * The per-file schema is shared across the tests in this file, so every test
 * scopes its assertions by a unique `subjectId` / address rather than reading
 * the whole table.
 *
 * `emitNotification` runs on the caller's transaction. The brief's sketch calls
 * `runInTransaction`, but that uses the app `prisma` singleton (bound to
 * `?schema=public`), not this file's disposable schema — so the transaction has
 * to be opened on `db()` itself, the same pattern as
 * `src/server/auth/__tests__/redeem.test.ts`.
 */

const uniq = () => randomBytes(5).toString("hex");

const mkInternal = (hats: $Enums.Hat[] = [], isActive = true) =>
  db().user.create({
    data: {
      email: `u-${uniq()}@k`,
      passwordHash: "x",
      displayName: "U",
      kind: "INTERNAL",
      hats,
      isActive,
    },
  });

test("{ hat } resolves to active internal holders, excluding the actor, one Notification each", async () => {
  const a = await mkInternal(["TECHNICAL_APPROVER"]);
  const b = await mkInternal(["TECHNICAL_APPROVER"]);
  const subjectId = `chg-${uniq()}`;

  await db().$transaction((tx) =>
    emitNotification(tx, {
      recipients: { hat: "TECHNICAL_APPROVER" },
      kind: "APPROVAL_NEEDED",
      subjectType: "Change",
      subjectId,
      summary: "needs you",
      excludeActorId: a.id,
    }),
  );

  const notes = await db().notification.findMany({ where: { subjectId } });
  expect(notes.map((n) => n.userId)).toEqual([b.id]);
  expect(notes[0]!.kind).toBe("APPROVAL_NEEDED");
  expect(notes[0]!.payload).toEqual({
    summary: "needs you",
    subjectType: "Change",
    subjectId,
  });
});

test("email spec writes an EmailOutbox row per recipient with an address", async () => {
  const u1 = await mkInternal(["BUSINESS_APPROVER"]);
  const u2 = await mkInternal(["BUSINESS_APPROVER"]);
  const subjectId = `chg-${uniq()}`;

  await db().$transaction((tx) =>
    emitNotification(tx, {
      recipients: { hat: "BUSINESS_APPROVER" },
      kind: "APPROVAL_NEEDED",
      subjectType: "Change",
      subjectId,
      summary: "review please",
      email: { template: "guest_invite", payload: { url: "x" } },
    }),
  );

  const rows = await db().emailOutbox.findMany({
    where: { toEmail: { in: [u1.email, u2.email] } },
  });
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.toEmail).sort()).toEqual(
    [u1.email, u2.email].sort(),
  );
  expect(rows.every((r) => r.template === "guest_invite")).toBe(true);
  expect(rows.every((r) => r.status === "PENDING")).toBe(true);
  expect(rows[0]!.payload).toEqual({ url: "x" });

  // The in-app rows are still written alongside the email rows.
  const notes = await db().notification.findMany({ where: { subjectId } });
  expect(notes).toHaveLength(2);
});

test("nothing is written when the surrounding transaction rolls back", async () => {
  const u = await mkInternal();
  const subjectId = `x-${uniq()}`;

  await expect(
    db().$transaction(async (tx) => {
      await emitNotification(tx, {
        recipients: { userIds: [u.id] },
        kind: "ASSIGNED",
        subjectType: "X",
        subjectId,
        summary: "s",
        email: { template: "guest_invite", payload: { url: "x" } },
      });
      throw new Error("boom");
    }),
  ).rejects.toThrow(/boom/);

  expect(await db().notification.count({ where: { subjectId } })).toBe(0);
  expect(await db().emailOutbox.count({ where: { toEmail: u.email } })).toBe(0);
});

test("{ audience: 'ALL_INTERNAL' } excludes GUEST users and inactive users", async () => {
  const active = await mkInternal();
  const inactive = await mkInternal([], false);
  const client = await db().client.create({
    data: { name: `C-${uniq()}`, isActive: true },
  });
  const guest = await db().user.create({
    data: {
      email: `g-${uniq()}@k`,
      passwordHash: "x",
      displayName: "G",
      kind: "GUEST",
      hats: [],
      clientId: client.id,
    },
  });
  const subjectId = `dem-${uniq()}`;

  await db().$transaction((tx) =>
    emitNotification(tx, {
      recipients: { audience: "ALL_INTERNAL" },
      kind: "STATUS_CHANGED",
      subjectType: "Demand",
      subjectId,
      summary: "moved",
    }),
  );

  const userIds = (
    await db().notification.findMany({ where: { subjectId } })
  ).map((n) => n.userId);
  expect(userIds).toContain(active.id);
  expect(userIds).not.toContain(inactive.id);
  expect(userIds).not.toContain(guest.id);
});

test("{ userIds } with a mix of real and bogus ids notifies only the real ones", async () => {
  const real = await mkInternal();
  const subjectId = `inc-${uniq()}`;

  await db().$transaction((tx) =>
    emitNotification(tx, {
      recipients: { userIds: [real.id, "does-not-exist", "also-bogus"] },
      kind: "COMMENTED",
      subjectType: "Incident",
      subjectId,
      summary: "new comment",
    }),
  );

  const notes = await db().notification.findMany({ where: { subjectId } });
  expect(notes.map((n) => n.userId)).toEqual([real.id]);
});
