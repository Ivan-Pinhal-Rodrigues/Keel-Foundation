import { afterAll, beforeAll, expect, test } from "vitest";
import { POST } from "@/app/api/auth/login/route";
import { useAuthDb } from "@/server/auth/db";
import { hashPassword } from "@/server/auth/password";
import { getSessionAndUser } from "@/server/auth/session";
import { withTestDb } from "@/test/db";

const db = withTestDb();

// The route resolves its client through `authDb()`; point that at this file's
// disposable schema so nothing is seeded into `public`. See server/auth/db.ts.
beforeAll(() => useAuthDb(db()));
afterAll(() => useAuthDb(null));

let userId = "";

beforeAll(async () => {
  const u = await db().user.create({
    data: {
      email: "cto@keel.local",
      passwordHash: await hashPassword("secret12"),
      displayName: "CTO",
      kind: "INTERNAL",
      hats: ["DEVELOPER"],
    },
  });
  userId = u.id;
}, 60_000);

/** One login request. Each test uses its own client IP so the per-IP rate
 *  limiter (module state, shared across a file) cannot leak between tests. */
const login = (body: unknown, ip: string) =>
  POST(
    new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `${ip}, 10.0.0.9`,
        "user-agent": "vitest-agent",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

test("valid credentials → 200, a session cookie, and exactly one Session row", async () => {
  const res = await login(
    { email: "cto@keel.local", password: "secret12" },
    "203.0.113.1",
  );
  expect(res.status).toBe(200);

  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toMatch(/authjs\.session-token=/);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=Lax/i);

  const rows = await db().session.findMany({ where: { userId } });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.ip).toBe("203.0.113.1");
  expect(rows[0]?.userAgent).toBe("vitest-agent");

  const token = /authjs\.session-token=([^;]+)/.exec(setCookie ?? "")?.[1];
  expect(token).toBeTruthy();
  const resolved = await getSessionAndUser(decodeURIComponent(token ?? ""));
  expect(resolved?.user.id).toBe(userId);
});

test("bad credentials → 401 and no cookie", async () => {
  const before = await db().session.count();
  const res = await login(
    { email: "cto@keel.local", password: "nope" },
    "203.0.113.2",
  );
  expect(res.status).toBe(401);
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(await db().session.count()).toBe(before);
});

test("a malformed body → 400", async () => {
  expect((await login({ email: "not-an-email" }, "203.0.113.3")).status).toBe(
    400,
  );
  expect((await login("}{ not json", "203.0.113.4")).status).toBe(400);
});

test("the per-IP rate limit trips after 10 attempts in the window", async () => {
  const ip = "203.0.113.5";
  const body = { email: "nobody@keel.local", password: "secret12" };
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await login(body, ip)).status);

  expect(statuses.slice(0, 10)).toEqual(Array<number>(10).fill(401));
  expect(statuses[10]).toBe(429);
  // Another client is unaffected — the bucket is per key, not global.
  expect((await login(body, "203.0.113.6")).status).toBe(401);
});
