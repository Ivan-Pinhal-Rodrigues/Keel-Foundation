/**
 * Next.js instrumentation hook — `register()` runs once as the server process
 * starts (https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).
 *
 * This file lives in `src/`, next to `middleware.ts`: Next looks for the hook in
 * the directory that contains `app/` (here, `src/`), not the repository root.
 *
 * Node.js runtime only — the Edge runtime cannot host a Postgres-backed polling
 * worker, and `register()` is also invoked there.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrap } = await import("@/server/bootstrap");
    bootstrap();
  }
}
