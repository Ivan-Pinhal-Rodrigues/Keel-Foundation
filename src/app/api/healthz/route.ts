/**
 * `GET /api/healthz` — liveness. The process is up; no dependency checks, no
 * DB (spec 08 §5). Always 200. Listed in `src/middleware.ts` PUBLIC.
 */
export async function GET(): Promise<Response> {
  return Response.json({ status: "ok" });
}
