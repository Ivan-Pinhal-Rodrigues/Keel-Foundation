import {
  outboxFailedGauge,
  outboxGauges,
  outboxPendingGauge,
  registry,
} from "@/server/metrics/registry";

/**
 * `GET /metrics` — Prometheus exposition (spec 08 §5, §7): default
 * process/Node metrics plus the app counters/gauges. No auth in v1
 * (cluster-internal assumption) — listed in `src/middleware.ts` PUBLIC, and
 * deliberately NOT wrapped in `withRequest`: this route must work with no
 * session and should not touch the request-context/actor machinery at all,
 * same as `healthz` / `readyz`.
 */
export async function GET(): Promise<Response> {
  const { pending, failed } = await outboxGauges();
  outboxPendingGauge.set(pending);
  outboxFailedGauge.set(failed);

  return new Response(await registry.metrics(), {
    headers: { "content-type": registry.contentType },
  });
}
