import { expect, test, vi } from "vitest";
import { GET } from "@/app/api/metrics/route";
import { withRouteTestDb } from "@/test/route-db";

/**
 * `GET /metrics` — no `withRequest` wrapper, so no cookie is needed; the
 * outbox gauges still read the DB (`outboxGauges()`), so this route test
 * uses the same `route-db` seam as the other route tests.
 *
 * UNEXECUTED as of this task: Docker/WSL is down on this host, so the
 * compose DB `withRouteTestDb()` needs is unreachable. Written per the
 * `route-db` harness (see `src/app/api/guest-invites/__tests__/create.route.test.ts`)
 * and hand-verified by close reading.
 */
vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
withRouteTestDb();

test("GET /metrics: 200, text/plain, no cookie required, carries the app counters/gauges and a default Node metric", async () => {
  const res = await GET();

  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/^text\/plain/);

  const body = await res.text();
  expect(body).toContain("keel_http_requests_total");
  expect(body).toContain("keel_outbox_pending");
  expect(body).toContain("keel_outbox_failed");
  expect(body).toContain("keel_auth_logins_total");
  expect(body).toContain("process_cpu_user_seconds_total");
});
