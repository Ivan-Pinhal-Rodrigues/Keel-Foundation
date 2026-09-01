import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { DELETE } from "@/app/api/sessions/[id]/route";
import { GET } from "@/app/api/sessions/route";
import { createSession } from "@/server/auth/session";
import { prisma as db } from "@/server/db/client";
import { applyMigrationsToNewSchema, dropSchema } from "@/test/db";

const { schema } = await vi.hoisted(async () => {
  const { randomBytes } = await import("node:crypto");
  return { schema: `test_${randomBytes(6).toString("hex")}` };
});

vi.mock("@/server/db/client", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { migrateUrlForSchema } = await import("@/test/db");
  return {
    prisma: new PrismaClient({
      datasources: { db: { url: migrateUrlForSchema(schema) } },
    }),
  };
});

// A — plain internal (no session-admin hat). B — another plain internal.
// T — a TECHNICAL_APPROVER (may administer sessions).
let A = "";
let B = "";
let T = "";

const mkUser = (email: string, hats: ("DEVELOPER" | "TECHNICAL_APPROVER")[]) =>
  db.user.create({
    data: {
      email,
      passwordHash: "x",
      displayName: email,
      kind: "INTERNAL",
      hats,
    },
  });

beforeAll(async () => {
  await applyMigrationsToNewSchema(schema);
  A = (await mkUser("a@keel.local", ["DEVELOPER"])).id;
  B = (await mkUser("b@keel.local", ["DEVELOPER"])).id;
  T = (await mkUser("t@keel.local", ["TECHNICAL_APPROVER"])).id;
}, 180_000);

afterAll(async () => {
  await db.$disconnect();
  await dropSchema(schema);
}, 120_000);

/** A fresh session for `userId`; returns the raw cookie token. */
async function session(userId: string): Promise<string> {
  const { token } = await createSession(userId, { ip: "10.0.0.1" });
  return token;
}

const listReq = (token: string, query = "") =>
  GET(
    new Request(`http://localhost:3000/api/sessions${query}`, {
      headers: { cookie: `authjs.session-token=${token}` },
    }),
  );

const deleteReq = (token: string, id: string) =>
  DELETE(
    new Request(`http://localhost:3000/api/sessions/${id}`, {
      method: "DELETE",
      headers: { cookie: `authjs.session-token=${token}` },
    }),
    { params: Promise.resolve({ id }) },
  );

test("GET /api/sessions returns only the caller's rows, with no sessionToken field", async () => {
  const tokA = await session(A);
  await session(A);
  await session(B);

  const res = await listReq(tokA);
  expect(res.status).toBe(200);
  const { sessions } = (await res.json()) as {
    sessions: Array<Record<string, unknown>>;
  };

  const mine = await db.session.findMany({ where: { userId: A } });
  expect(sessions).toHaveLength(mine.length);
  for (const s of sessions) {
    expect(s).not.toHaveProperty("sessionToken");
    const row = await db.session.findUnique({ where: { id: s.id as string } });
    expect(row?.userId).toBe(A);
  }
});

test("a TECHNICAL_APPROVER with ?all=1 sees everyone's sessions, with the owner attached", async () => {
  await session(A);
  await session(B);
  const tokT = await session(T);

  const res = await listReq(tokT, "?all=1");
  expect(res.status).toBe(200);
  const { sessions } = (await res.json()) as {
    sessions: Array<{ userId?: string; user?: { email: string } }>;
  };

  const owners = new Set(sessions.map((s) => s.userId));
  expect(owners.has(A)).toBe(true);
  expect(owners.has(B)).toBe(true);
  expect(owners.has(T)).toBe(true);
  for (const s of sessions) {
    expect(typeof s.userId).toBe("string");
    expect(typeof s.user?.email).toBe("string");
  }
  expect(sessions.length).toBe(await db.session.count());
});

test("a non-TECHNICAL_APPROVER passing ?all=1 still only sees their own", async () => {
  const tokA = await session(A);
  await session(B);

  const res = await listReq(tokA, "?all=1");
  const { sessions } = (await res.json()) as {
    sessions: Array<Record<string, unknown>>;
  };

  expect(sessions).toHaveLength(
    await db.session.count({ where: { userId: A } }),
  );
  for (const s of sessions) {
    expect(s).not.toHaveProperty("userId");
    const row = await db.session.findUnique({ where: { id: s.id as string } });
    expect(row?.userId).toBe(A);
  }
});

test("DELETE of another user's session by a non-TECHNICAL_APPROVER → 404, row untouched", async () => {
  const tokA = await session(A);
  await createSession(B, { ip: "10.0.0.2" });
  const bSession = await db.session.findFirstOrThrow({ where: { userId: B } });

  const res = await deleteReq(tokA, bSession.id);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
  expect(
    await db.session.findUnique({ where: { id: bSession.id } }),
  ).not.toBeNull();
});

test("a TECHNICAL_APPROVER revoking another user's session → 200 + a session.revoked audit row", async () => {
  const tokT = await session(T);
  await createSession(B, { ip: "10.0.0.3" });
  const bSession = await db.session.findFirstOrThrow({ where: { userId: B } });

  const res = await deleteReq(tokT, bSession.id);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(
    await db.session.findUnique({ where: { id: bSession.id } }),
  ).toBeNull();

  const ev = await db.auditEvent.findFirst({
    where: { action: "session.revoked", subjectId: bSession.id },
  });
  expect(ev?.actorId).toBe(T);
  expect(ev?.subjectType).toBe("Session");
  expect(ev?.payload).toEqual({ targetUserId: B, self: false });
});

test("revoking your own session → 200 + session.revoked with self:true", async () => {
  const tokA = await session(A);
  const mine = await db.session.findFirstOrThrow({ where: { userId: A } });

  const res = await deleteReq(tokA, mine.id);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(await db.session.findUnique({ where: { id: mine.id } })).toBeNull();

  const ev = await db.auditEvent.findFirst({
    where: { action: "session.revoked", subjectId: mine.id },
  });
  expect(ev?.actorId).toBe(A);
  expect(ev?.payload).toEqual({ targetUserId: A, self: true });
});
