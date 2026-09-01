import { expect, test } from "vitest";
import { UnauthenticatedError, loadActor } from "@/server/auth/actor";
import { withTestDb } from "@/test/db";

const db = withTestDb();

test("loadActor returns the INTERNAL shape", async () => {
  const u = await db().user.create({
    data: {
      email: "i@k.local",
      passwordHash: "x",
      displayName: "I",
      kind: "INTERNAL",
      hats: ["DEVELOPER", "BUSINESS_APPROVER"],
    },
  });
  expect(await loadActor(u.id, db())).toEqual({
    id: u.id,
    kind: "INTERNAL",
    hats: ["DEVELOPER", "BUSINESS_APPROVER"],
    clientId: null,
  });
});

test("loadActor returns the GUEST shape with clientId", async () => {
  const c = await db().client.create({ data: { name: "N", isActive: true } });
  const u = await db().user.create({
    data: {
      email: "g@n.example",
      passwordHash: "x",
      displayName: "G",
      kind: "GUEST",
      hats: [],
      clientId: c.id,
    },
  });
  expect(await loadActor(u.id, db())).toEqual({
    id: u.id,
    kind: "GUEST",
    hats: [],
    clientId: c.id,
  });
});

test("loadActor throws UnauthenticatedError for an inactive user", async () => {
  const u = await db().user.create({
    data: {
      email: "inactive@k.local",
      passwordHash: "x",
      displayName: "Gone",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
      isActive: false,
    },
  });
  await expect(loadActor(u.id, db())).rejects.toBeInstanceOf(
    UnauthenticatedError,
  );
});

test("loadActor throws UnauthenticatedError for a nonexistent id", async () => {
  await expect(loadActor("does-not-exist", db())).rejects.toBeInstanceOf(
    UnauthenticatedError,
  );
});
