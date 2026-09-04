import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { POST } from "@/app/api/auth/logout/route";
import { createSession } from "@/server/auth/session";
import { prisma as db } from "@/server/db/client";
import { createTestDb } from "@/test/db";

/** Same DB seam as the login route test — the singleton module is mocked and
 *  bound to a database this file owns. (New route tests should use
 *  `withRouteTestDb()` from `@/test/route-db`, which packages this dance — see
 *  `guest-invites/__tests__/create.route.test.ts`.) */
const { dbName } = await vi.hoisted(async () => {
  const { randomBytes } = await import("node:crypto");
  return { dbName: `test_${randomBytes(6).toString("hex")}` };
});

vi.mock("@/server/db/client", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { migrateUrlForDb } = await import("@/test/db");
  return {
    prisma: new PrismaClient({
      datasources: { db: { url: migrateUrlForDb(dbName) } },
    }),
  };
});

let userId = "";

beforeAll(async () => {
  await createTestDb(dbName);
  const u = await db.user.create({
    data: {
      email: "dev@keel.local",
      passwordHash: "x",
      displayName: "Dev",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  userId = u.id;
}, 180_000);

// Disconnect only — `global-setup.ts` sweeps the clone. See `withTestDb()`.
afterAll(async () => {
  await db.$disconnect();
}, 120_000);

const logoutReq = (cookie?: string) =>
  POST(
    new Request("http://localhost:3000/api/auth/logout", {
      method: "POST",
      headers: cookie ? { cookie } : {},
    }),
  );

test("logout drops the session row, clears the cookie, and emits auth.logout", async () => {
  const { token } = await createSession(userId, { ip: "1.1.1.1" });
  expect(await db.session.count({ where: { userId } })).toBe(1);

  const res = await logoutReq(`authjs.session-token=${token}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie).toMatch(/^authjs\.session-token=;/);

  expect(await db.session.count({ where: { userId } })).toBe(0);

  const events = await db.auditEvent.findMany({
    where: { action: "auth.logout" },
  });
  expect(events).toHaveLength(1);
  expect(events[0]?.actorId).toBe(userId);
  expect(events[0]?.subjectType).toBe("User");
  expect(events[0]?.subjectId).toBe(userId);
  expect(events[0]?.requestId).toBeTruthy();
});

test("logout with no session is idempotent — 200 and an auth.logout with a null actor", async () => {
  const res = await logoutReq();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const events = await db.auditEvent.findMany({
    where: { action: "auth.logout", actorId: null },
    orderBy: { at: "desc" },
  });
  expect(events.length).toBeGreaterThanOrEqual(1);
  expect(events[0]?.subjectId).toBe("unknown");
});
