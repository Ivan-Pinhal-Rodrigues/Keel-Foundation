import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import {
  httpRequestsTotal,
  normalizeRoute,
  outboxGauges,
  registry,
} from "@/server/metrics/registry";

test("normalizeRoute: collapses a cuid-shaped id segment to :id", () => {
  expect(normalizeRoute("/api/demands/cm3x9k2q10000abcdefghijk")).toBe(
    "/api/demands/:id",
  );
});

test("normalizeRoute: a static path with no dynamic segment is unchanged", () => {
  expect(normalizeRoute("/api/notifications")).toBe("/api/notifications");
  expect(normalizeRoute("/api/demands")).toBe("/api/demands");
});

test("normalizeRoute: collapses a UUID-shaped segment to :id", () => {
  expect(
    normalizeRoute("/api/sessions/550e8400-e29b-41d4-a716-446655440000"),
  ).toBe("/api/sessions/:id");
});

test("normalizeRoute: a nested static path keeps every static segment and only collapses the dynamic one", () => {
  expect(normalizeRoute("/api/demands/cm3x9k2q10000abcdefghijk/comments")).toBe(
    "/api/demands/:id/comments",
  );
});

/**
 * Pure in-memory `prom-client` assertion — no DB, no `withTestDb()`. Resets
 * the registry first so this test's `.inc()` isn't riding on a count left
 * behind by another test/module in the same worker.
 */
test("httpRequestsTotal: inc({method,route,status}) records one observation with those labels", async () => {
  registry.resetMetrics();

  httpRequestsTotal.inc({
    method: "GET",
    route: "/api/demands/:id",
    status: "200",
  });

  const metric = await httpRequestsTotal.get();

  expect(metric.values).toEqual([
    {
      value: 1,
      labels: { method: "GET", route: "/api/demands/:id", status: "200" },
    },
  ]);
});

/**
 * Integration test — seeds `EmailOutbox` rows of all four `OutboxStatus`
 * values against the compose DB and asserts `outboxGauges` counts only
 * PENDING and FAILED. The SENDING row is the one that actually matters here:
 * there's no `sending` gauge, so this proves `outboxGauges` doesn't
 * accidentally lump SENDING into the `pending` or `failed` counts.
 *
 * UNEXECUTED as of this task: Docker/WSL is down on this host, so the
 * compose DB is unreachable and `withTestDb()`'s `beforeAll` (which creates
 * a disposable clone database) cannot run. Written per the `withTestDb()`
 * harness used by `src/server/audit/__tests__/read.test.ts` and
 * hand-verified by close reading against `outboxGauges`'s implementation.
 */
const db = withTestDb();

test("outboxGauges: counts PENDING and FAILED rows, ignoring other statuses", async () => {
  await db().emailOutbox.create({
    data: {
      toEmail: "pending@example.com",
      template: "test",
      payload: {},
      status: "PENDING",
    },
  });
  await db().emailOutbox.create({
    data: {
      toEmail: "pending2@example.com",
      template: "test",
      payload: {},
      status: "PENDING",
    },
  });
  await db().emailOutbox.create({
    data: {
      toEmail: "failed@example.com",
      template: "test",
      payload: {},
      status: "FAILED",
    },
  });
  await db().emailOutbox.create({
    data: {
      toEmail: "sent@example.com",
      template: "test",
      payload: {},
      status: "SENT",
    },
  });
  await db().emailOutbox.create({
    data: {
      toEmail: "sending@example.com",
      template: "test",
      payload: {},
      status: "SENDING",
    },
  });

  const gauges = await outboxGauges(db());

  expect(gauges).toEqual({ pending: 2, failed: 1 });
});
