import { startOutboxWorker } from "@/server/modules/notify/worker";

/**
 * One-time server-process bootstrap, invoked from the Next instrumentation hook
 * (`src/instrumentation.ts`).
 *
 * Guarded on `globalThis` so it is a no-op after the first call — Next can run
 * `register()` more than once (dev hot-reload, multiple entrypoints), and only
 * one polling worker should ever start.
 */
export function bootstrap(): void {
  const g = globalThis as unknown as { __keelBooted?: boolean };
  if (g.__keelBooted) return;
  g.__keelBooted = true;
  startOutboxWorker();
}
