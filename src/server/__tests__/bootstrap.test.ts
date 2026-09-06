import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as worker from "@/server/modules/notify/worker";

/**
 * Pure unit test — no DB. The bootstrap guard is `globalThis` state, so each
 * test resets both guard globals up front and tears any real interval down
 * after, keeping the file order-independent and letting the suite exit cleanly.
 */
type Guards = {
  __keelBooted?: boolean;
  __keelOutbox?: NodeJS.Timeout;
  __keelOverdueSweeper?: NodeJS.Timeout;
};

beforeEach(() => {
  const g = globalThis as Guards;
  delete g.__keelBooted;
  delete g.__keelOutbox;
  delete g.__keelOverdueSweeper;
});

afterEach(() => {
  const g = globalThis as Guards;
  if (g.__keelOutbox) clearInterval(g.__keelOutbox);
  if (g.__keelOverdueSweeper) clearInterval(g.__keelOverdueSweeper);
  delete g.__keelOutbox;
  delete g.__keelOverdueSweeper;
  delete g.__keelBooted;
  vi.restoreAllMocks();
});

test("bootstrap starts each poller exactly once across repeated calls", async () => {
  const spy = vi.spyOn(globalThis, "setInterval");
  const { bootstrap } = await import("@/server/bootstrap");

  bootstrap();
  const afterFirst = spy.mock.calls.length;
  bootstrap();

  // One interval per poller (outbox worker + overdue sweeper); a second
  // bootstrap() adds none.
  expect(afterFirst).toBe(2);
  expect(spy).toHaveBeenCalledTimes(afterFirst);
});

test("bootstrap's own guard blocks a second startOutboxWorker call", async () => {
  // Isolate bootstrap's `__keelBooted` guard from the worker's own idempotency:
  // stub the worker so a second start would be visible as a second call.
  const start = vi
    .spyOn(worker, "startOutboxWorker")
    .mockImplementation(() => {});
  const { bootstrap } = await import("@/server/bootstrap");

  bootstrap();
  bootstrap();

  expect(start).toHaveBeenCalledTimes(1);
});

test("bootstrap installs a timer handle on globalThis", async () => {
  const { bootstrap } = await import("@/server/bootstrap");

  bootstrap();

  expect((globalThis as Guards).__keelOutbox).toBeDefined();
  expect((globalThis as Guards).__keelOverdueSweeper).toBeDefined();
});
