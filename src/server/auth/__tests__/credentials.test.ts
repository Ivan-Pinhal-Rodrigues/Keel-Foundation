import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { verifyCredentials } from "@/server/auth/credentials";
import { withTestDb } from "@/test/db";

// Wrap the real argon2 verify so the timing-equalisation fix can be asserted on
// directly — call counts, not wall-clock — while still doing the real work.
vi.mock("@/server/auth/password", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/auth/password")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

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

beforeEach(() => vi.mocked(verifyPassword).mockClear());

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

test("every outcome pays for exactly one argon2 verify", async () => {
  // The whole point of the dummy hash: an unknown address and a deactivated
  // account must not answer faster than a wrong password, or latency leaks
  // which emails have accounts.
  const cases = [
    { email: "cto@keel.local", password: "secret12" }, // success
    { email: "cto@keel.local", password: "wrong" }, // wrong password
    { email: "left@keel.local", password: "secret12" }, // deactivated
    { email: "nobody@keel.local", password: "secret12" }, // unknown email
  ];

  for (const input of cases) {
    vi.mocked(verifyPassword).mockClear();
    await verifyCredentials(db(), input);
    expect(
      vi.mocked(verifyPassword).mock.calls.length,
      `expected one verify for ${input.email} / ${input.password}`,
    ).toBe(1);
  }
});

test("the miss paths actually spend the argon2 time", async () => {
  // A belt-and-braces check on the observable property rather than the
  // mechanism. Real argon2 at these parameters is ~15ms+; skipping it entirely
  // would return in well under 1ms, so the 5ms floor has a wide margin.
  const started = Date.now();
  await verifyCredentials(db(), {
    email: "nobody@keel.local",
    password: "secret12",
  });
  expect(Date.now() - started).toBeGreaterThan(5);
});
