import { beforeAll, expect, test } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { verifyCredentials } from "@/server/auth/credentials";
import { withTestDb } from "@/test/db";

const db = withTestDb();

let activeId = "";

beforeAll(async () => {
  const passwordHash = await hashPassword("secret12");
  const active = await db().user.create({
    data: {
      email: "cto@keel.local",
      passwordHash,
      displayName: "CTO",
      kind: "INTERNAL",
      hats: ["DEVELOPER", "TECHNICAL_APPROVER"],
    },
  });
  activeId = active.id;
  await db().user.create({
    data: {
      email: "left@keel.local",
      passwordHash,
      displayName: "Left",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
      isActive: false,
    },
  });
}, 60_000);

test("valid email + password returns the user id", async () => {
  await expect(
    verifyCredentials(db(), { email: "cto@keel.local", password: "secret12" }),
  ).resolves.toEqual({ id: activeId });
});

test("wrong password returns null", async () => {
  await expect(
    verifyCredentials(db(), { email: "cto@keel.local", password: "wrong" }),
  ).resolves.toBeNull();
});

test("a deactivated user returns null even with the right password", async () => {
  await expect(
    verifyCredentials(db(), { email: "left@keel.local", password: "secret12" }),
  ).resolves.toBeNull();
});

test("an unknown email returns null", async () => {
  await expect(
    verifyCredentials(db(), {
      email: "nobody@keel.local",
      password: "secret12",
    }),
  ).resolves.toBeNull();
});
