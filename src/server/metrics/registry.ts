import type { PrismaClient } from "@prisma/client";
import { Counter, Gauge, collectDefaultMetrics, Registry } from "prom-client";
import { prisma } from "@/server/db/client";

/**
 * The process-wide Prometheus registry (spec 08 §5, §7) — `GET /metrics`
 * serves this. Default Node/process metrics are collected once at module
 * load; `httpRequestsTotal` and `authLoginsTotal` are incremented from
 * `withRequest` and the login route respectively (both single additive
 * lines — see those files); `outboxGauges` is read fresh on every scrape
 * rather than kept as a background-updated gauge, so the exposition always
 * reflects current DB state.
 */
export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new Counter({
  name: "keel_http_requests_total",
  help: "Total HTTP requests handled by withRequest, by method/route/status.",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const authLoginsTotal = new Counter({
  name: "keel_auth_logins_total",
  help: "Total POST /api/auth/login attempts that reached a credential check, by result.",
  labelNames: ["result"] as const,
  registers: [registry],
});

/** Current pending/failed `EmailOutbox` row counts — set from a fresh
 *  `outboxGauges()` read on every `/metrics` scrape (see the route handler),
 *  not updated in the background. */
export const outboxPendingGauge = new Gauge({
  name: "keel_outbox_pending",
  help: "Current count of EmailOutbox rows with status PENDING.",
  registers: [registry],
});

export const outboxFailedGauge = new Gauge({
  name: "keel_outbox_failed",
  help: "Current count of EmailOutbox rows with status FAILED.",
  registers: [registry],
});

/**
 * Collapse dynamic-looking path segments to `:id` so `httpRequestsTotal`'s
 * `route` label stays bounded cardinality — a raw id per request would mint
 * one Prometheus time series per unique id ever requested. A segment counts
 * as dynamic when it looks like this codebase's cuid-shaped ids
 * (`/^[a-z0-9]{20,32}$/i`) or a UUID.
 */
const CUID_LIKE = /^[a-z0-9]{20,32}$/i;
const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeRoute(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) =>
      seg.length > 0 && (CUID_LIKE.test(seg) || UUID_LIKE.test(seg))
        ? ":id"
        : seg,
    )
    .join("/");
}

/**
 * Fresh `EmailOutbox` counts by status, read on every `/metrics` scrape
 * (`keel_outbox_pending` / `keel_outbox_failed`). Optional `client` param
 * mirrors the module-service pattern in `@/server/audit/read` — tests pass
 * their own disposable-DB client.
 */
export async function outboxGauges(
  client: PrismaClient = prisma,
): Promise<{ pending: number; failed: number }> {
  const [pending, failed] = await Promise.all([
    client.emailOutbox.count({ where: { status: "PENDING" } }),
    client.emailOutbox.count({ where: { status: "FAILED" } }),
  ]);
  return { pending, failed };
}
