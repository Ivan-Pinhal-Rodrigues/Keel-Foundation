import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import {
  createSession,
  destroySession,
  getSessionAndUser,
  touchSession,
} from "@/server/auth/session";
import { withTestDb } from "@/test/db";

const db = withTestDb();

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

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

test("createSession writes exactly one row and getSessionAndUser resolves it", async () => {
  const u = await seedUser("x@k.local");
  const { token, expires } = await createSession(
    u.id,
    { userAgent: "vitest", ip: "10.0.0.1" },
    db(),
  );

  const rows = await db().session.findMany({ where: { userId: u.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.userAgent).toBe("vitest");
  expect(rows[0]?.ip).toBe("10.0.0.1");
  // 32 random bytes, base64url — 43 chars, no padding, url-safe alphabet only.
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(expires.getTime()).toBeGreaterThan(Date.now());

  const resolved = await getSessionAndUser(token, db());
  expect(resolved?.user.id).toBe(u.id);
});

test("the token is stored hashed — the raw token is never in the table", async () => {
  const u = await seedUser("hashed@k.local");
  const { token } = await createSession(u.id, undefined, db());

  const row = await db().session.findFirstOrThrow({ where: { userId: u.id } });
  expect(row.sessionToken).not.toBe(token);
  expect(row.sessionToken).toBe(sha256(token));
  expect(row.sessionToken).toMatch(/^[0-9a-f]{64}$/);

  // The raw token resolves; the stored digest, presented as a cookie, does not
  // — a database leak yields nothing that can be replayed.
  expect(await getSessionAndUser(token, db())).not.toBeNull();
  expect(await getSessionAndUser(row.sessionToken, db())).toBeNull();
});

test("destroySession removes the row", async () => {
  const u = await seedUser("y@k.local");
  const { token } = await createSession(u.id, undefined, db());
  await destroySession(token, db());
  expect(await getSessionAndUser(token, db())).toBeNull();
  expect(await db().session.count({ where: { userId: u.id } })).toBe(0);
});

test("getSessionAndUser returns null for an expired session", async () => {
  const u = await seedUser("expired@k.local");
  const { token } = await createSession(u.id, undefined, db());
  await db().session.update({
    where: { sessionToken: sha256(token) },
    data: { expires: new Date(Date.now() - 1_000) },
  });
  expect(await getSessionAndUser(token, db())).toBeNull();
});

test("getSessionAndUser returns null once the user is deactivated", async () => {
  const u = await seedUser("gone@k.local");
  const { token } = await createSession(u.id, undefined, db());
  await db().user.update({ where: { id: u.id }, data: { isActive: false } });
  expect(await getSessionAndUser(token, db())).toBeNull();
});

test("touchSession extends expires and bumps lastSeenAt on a live session", async () => {
  const u = await seedUser("touch@k.local");
  const { token } = await createSession(u.id, undefined, db());
  // Still live, but close to the edge and stale.
  const nearlyDone = new Date(Date.now() + 60_000);
  const stale = new Date(Date.now() - 60 * 60 * 1000);
  await db().session.update({
    where: { sessionToken: sha256(token) },
    data: { expires: nearlyDone, lastSeenAt: stale },
  });

  await touchSession(token, db());

  const after = await db().session.findUniqueOrThrow({
    where: { sessionToken: sha256(token) },
  });
  expect(after.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
  // Sliding window: back out to ~30 days from now.
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  expect(after.expires.getTime() - Date.now()).toBeGreaterThan(
    thirtyDays - 60_000,
  );
});

test("touchSession cannot revive an expired session", async () => {
  const u = await seedUser("revive@k.local");
  const { token } = await createSession(u.id, undefined, db());
  const dead = new Date(Date.now() - 1_000);
  await db().session.update({
    where: { sessionToken: sha256(token) },
    data: { expires: dead, lastSeenAt: dead },
  });

  await touchSession(token, db());

  const after = await db().session.findUniqueOrThrow({
    where: { sessionToken: sha256(token) },
  });
  expect(after.expires.getTime()).toBe(dead.getTime());
  expect(after.lastSeenAt.getTime()).toBe(dead.getTime());
  expect(await getSessionAndUser(token, db())).toBeNull();
});
