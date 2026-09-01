import { afterAll, beforeAll, expect, test } from "vitest";
import { useAuthDb } from "@/server/auth/db";
import {
  createSession,
  destroySession,
  getSessionAndUser,
  touchSession,
} from "@/server/auth/session";
import { withTestDb } from "@/test/db";

const db = withTestDb();

// Point the auth module at this file's disposable schema (see src/server/auth/db.ts).
beforeAll(() => useAuthDb(db()));
afterAll(() => useAuthDb(null));

const seedUser = (email: string, isActive = true) =>
  db().user.create({
    data: {
      email,
      passwordHash: "x",
      displayName: email,
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
      isActive,
    },
  });

test("createSession writes exactly one row and getSessionAndUser resolves it", async () => {
  const u = await seedUser("x@k.local");
  const { token, expires } = await createSession(u.id, {
    userAgent: "vitest",
    ip: "10.0.0.1",
  });

  const rows = await db().session.findMany({ where: { userId: u.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.userAgent).toBe("vitest");
  expect(rows[0]?.ip).toBe("10.0.0.1");
  // 32 random bytes, base64url — 43 chars, no padding, url-safe alphabet only.
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(expires.getTime()).toBeGreaterThan(Date.now());

  const resolved = await getSessionAndUser(token);
  expect(resolved?.user.id).toBe(u.id);
  expect(resolved?.session.sessionToken).toBe(token);
});

test("destroySession removes the row", async () => {
  const u = await seedUser("y@k.local");
  const { token } = await createSession(u.id);
  await destroySession(token);
  expect(await getSessionAndUser(token)).toBeNull();
  expect(await db().session.count({ where: { userId: u.id } })).toBe(0);
});

test("getSessionAndUser returns null for an expired session", async () => {
  const u = await seedUser("expired@k.local");
  const { token } = await createSession(u.id);
  await db().session.update({
    where: { sessionToken: token },
    data: { expires: new Date(Date.now() - 1_000) },
  });
  expect(await getSessionAndUser(token)).toBeNull();
});

test("getSessionAndUser returns null once the user is deactivated", async () => {
  const u = await seedUser("gone@k.local");
  const { token } = await createSession(u.id);
  await db().user.update({ where: { id: u.id }, data: { isActive: false } });
  expect(await getSessionAndUser(token)).toBeNull();
});

test("touchSession extends expires and bumps lastSeenAt", async () => {
  const u = await seedUser("touch@k.local");
  const { token } = await createSession(u.id);
  const stale = new Date(Date.now() - 60 * 60 * 1000);
  await db().session.update({
    where: { sessionToken: token },
    data: { expires: stale, lastSeenAt: stale },
  });

  await touchSession(token);

  const after = await db().session.findUniqueOrThrow({
    where: { sessionToken: token },
  });
  expect(after.expires.getTime()).toBeGreaterThan(stale.getTime());
  expect(after.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
  // Sliding window: back out to ~30 days from now.
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  expect(after.expires.getTime() - Date.now()).toBeGreaterThan(
    thirtyDays - 60_000,
  );
});
