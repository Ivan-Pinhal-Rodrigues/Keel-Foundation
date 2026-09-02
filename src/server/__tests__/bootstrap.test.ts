import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as worker from "@/server/modules/notify/worker";

/**
 * Pure unit test — no DB. The bootstrap guard is `globalThis` state, so each
 * test resets both guard globals up front and tears any real interval down
 * after, keeping the file order-independent and letting the suite exit cleanly.
 */
type Guards = { __keelBooted?: boolean; __keelOutbox?: NodeJS.Timeout };

beforeEach(() => {
  const g = globalThis as Guards;
  delete g.__keelBooted;
  delete g.__keelOutbox;
});

afterEach(() => {
  const g = globalThis as Guards;
  if (g.__keelOutbox) clearInterval(g.__keelOutbox);
  delete g.__keelOutbox;
  delete g.__keelBooted;
  vi.restoreAllMocks();
});

test("bootstrap starts the worker exactly once across repeated calls", async () => {
  const spy = vi.spyOn(globalThis, "setInterval");
  const { bootstrap } = await import("@/server/bootstrap");

  bootstrap();
  bootstrap();

  expect(spy).toHaveBeenCalledTimes(1);
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
});
