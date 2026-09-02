import { checkReadiness } from "@/server/health/readiness";

/**
 * `GET /api/readyz` — readiness (spec 08 §5). `SELECT 1` against the DB plus a
 * check that every migration folder is applied. 200 when both pass; 503 with
 * the failing check named in `checks` otherwise. Listed in `src/middleware.ts`
 * PUBLIC.
 */
export async function GET(): Promise<Response> {
  const r = await checkReadiness();
  return Response.json(
    { status: r.ok ? "ok" : "unavailable", checks: r.checks },
    { status: r.ok ? 200 : 503 },
  );
}
