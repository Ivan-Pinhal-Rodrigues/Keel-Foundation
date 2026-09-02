import { afterEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

afterEach(() => {
  vi.unstubAllEnvs();
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const run = (path: string, cookie?: string) =>
  middleware(
    new NextRequest(`http://localhost:3000${path}`, {
      headers: cookie ? { cookie } : {},
    }),
  );

test("no session cookie on a protected route → 307 redirect to /login", () => {
  const res = run("/overview");
  expect(res.status).toBe(307);
  const location = res.headers.get("location") ?? "";
  expect(location).toContain("/login");
  expect(location).toContain("next=%2Foverview");
});

test("no session cookie on an API route → 401 JSON", async () => {
  const res = run("/api/demands");
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthenticated" });
});

test("healthz is public → next() (200, no redirect)", () => {
  const res = run("/api/healthz");
  expect(res.status).toBe(200);
  expect(res.headers.get("location")).toBeNull();
});

test("the guest-invite redeem route is public (pre-auth) → next()", () => {
  const res = run("/api/guest-invites/some-raw-token/redeem");
  expect(res.status).toBe(200);
  expect(res.headers.get("location")).toBeNull();
});

test("the guest-invite create route is NOT public → 401 without a cookie", async () => {
  const res = run("/api/guest-invites");
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthenticated" });
});

test("a request carrying a session cookie on a protected route → next()", () => {
  const res = run("/overview", "authjs.session-token=opaque-token");
  expect(res.status).toBe(200);
  expect(res.headers.get("location")).toBeNull();
});

test("every response carries an x-request-id (a fresh UUID)", () => {
  const responses = [
    run("/overview"),
    run("/api/demands"),
    run("/api/healthz"),
    run("/login"),
    run("/overview", "authjs.session-token=opaque-token"),
  ];
  const ids = responses.map((r) => r.headers.get("x-request-id"));
  for (const id of ids) expect(id).toMatch(UUID_RE);
  // Minted per request, not reused.
  expect(new Set(ids).size).toBe(ids.length);
});

test("in production a /dev/* request is a bare 404, before any auth handling", () => {
  vi.stubEnv("NODE_ENV", "production");
  const res = run("/dev/components");
  expect(res.status).toBe(404);
  // Not a redirect to /login, and no 401 JSON — the route simply does not exist.
  expect(res.headers.get("location")).toBeNull();
  // Still correlated for logs.
  expect(res.headers.get("x-request-id")).toMatch(UUID_RE);
});

test("outside production /dev/* is public — next() with no auth redirect", () => {
  vi.stubEnv("NODE_ENV", "development");
  const res = run("/dev/components");
  expect(res.status).toBe(200);
  expect(res.headers.get("location")).toBeNull();
});
