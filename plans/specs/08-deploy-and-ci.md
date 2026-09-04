# Spec 08 — Deploy and CI

docker compose for local development, a multi-stage Dockerfile, a
cluster-agnostic Helm chart with staging + prod values, and the CI pipeline
that blocks merge on any failure.

Parent: [`../DESIGN.md`](../DESIGN.md). Owner: Phase 2.

---

## 1. Scope

**In:** `docker-compose.yml`, `Dockerfile`, `helm/keel/**`, the migration Job,
health / readiness / metrics endpoints, the seed script, the CI workflow, the
`kind` smoke test.

**Out (v2):** ArgoCD / Flux, real cluster targeting, TLS / cert-manager,
external-secrets operator wiring, image signing, SBOM, multi-arch builds,
metrics dashboards / Grafana, autoscaling tuning.

---

## 2. Local — docker compose

`docker-compose.yml` services:

- `db` — `postgres:16`, volume, healthcheck (`pg_isready`).
- `mailpit` — `axllent/mailpit`, ports `1025` (SMTP) + `8025` (UI).
- `app` — built from the `Dockerfile` `dev` target or run via `pnpm dev` on the
  host against compose `db`/`mailpit` (both documented). Env from `.env`.
- `migrate` — one-shot: `prisma migrate deploy` as `MIGRATE_DATABASE_URL`, then
  the grant SQL; `app` waits on its completion.

`.env.example` documents every variable. `pnpm seed` (see §6) is run by hand
after first `up`.

Two Postgres roles created by an init script: `keel_app` (runtime, restricted
on `audit_event`) and `keel_migrate` (DDL).

---

## 3. Dockerfile

Multi-stage:

1. `deps` — `pnpm fetch` / `pnpm install --frozen-lockfile`.
2. `build` — `pnpm build` (Next standalone output), `prisma generate`.
3. `runner` — `node:22-slim`, non-root `node` user, copy `.next/standalone`,
   `.next/static`, `public`, `prisma/`. `CMD ["node", "server.js"]`. No dev
   deps, no source, no secrets. `HEALTHCHECK` hits `/api/healthz`.

Image target size noted in the spec as a soft budget; not gated.

---

## 4. Helm chart — `helm/keel`

Templates:

- `deployment.yaml` — the app; `replicaCount` from values; `envFrom` a
  `Secret` **referenced by name** (`existingSecret`, default `keel-secrets`) +
  a `ConfigMap` for non-secret config (`APP_URL`, `NOTIFY_POLL_MS`, log level);
  liveness `/api/healthz`, readiness `/api/readyz`; resources from values.
- `service.yaml` — ClusterIP.
- `ingress.yaml` — toggled by `ingress.enabled`; `className` and `host` from
  values (placeholders in both value files); annotations pass-through map.
  The ingress/proxy MUST replace (not append to) `X-Forwarded-For` with the
  real client address before the request reaches the app. Until a trusted
  proxy is in place the login limiter keys on the submitted email only.
- `migrate-job.yaml` — `helm.sh/hook: pre-install,pre-upgrade`,
  `hook-delete-policy: before-hook-creation,hook-succeeded`; runs
  `prisma migrate deploy` + the grant SQL as the migrate role; `backoffLimit: 1`.
- `serviceaccount.yaml`, `hpa.yaml` (guarded by `autoscaling.enabled`, default
  `false`), `_helpers.tpl`, `NOTES.txt`.

Values:

- `values.yaml` — sane defaults, `ingress.enabled: false`, 1 replica.
- `values-staging.yaml` — 1 replica, modest resources, `ingress.enabled: true`
  with a placeholder host, `logLevel: debug`.
- `values-prod.yaml` — 2 replicas, higher resources, placeholder host,
  `logLevel: info`, `autoscaling.enabled: false` (present, off).

The chart contains **no secret values**. `helm-docs`-style README in the chart
dir listing every value and the required keys of `keel-secrets`
(`DATABASE_URL`, `MIGRATE_DATABASE_URL`, `SMTP_URL`).

---

## 5. Health, readiness, metrics

- `GET /api/healthz` — process is up. No dependency checks. Always 200 unless the
  process is broken.
- `GET /api/readyz` — `SELECT 1` against the DB **and** a check that
  `prisma migrate status` reports no pending migrations. 200 / 503 with a JSON
  body naming the failing check.
- `GET /metrics` — Prometheus text: default process metrics + a few app
  counters (`keel_http_requests_total`, `keel_outbox_pending`,
  `keel_outbox_failed`, `keel_auth_logins_total`). No auth in v1 (cluster-internal
  assumption noted).

---

## 6. Seed script

`pnpm seed` (`prisma/seed.ts`), idempotent (safe to re-run; upserts by a stable
key):

- Users (password in the script + README): `cto@keel.local` — `kind INTERNAL`,
  hats `DEVELOPER` + `REVIEWER` + `TECHNICAL_APPROVER`; `ceo@keel.local` —
  `kind INTERNAL`, hats `DEVELOPER` + `REVIEWER` + `BUSINESS_APPROVER`;
  optionally `founder@keel.local` holding all four hats to demo the override
  cleanly.
- Clients: "Northwind Traders", "Acme Retail"; one guest each
  (`guest@northwind.example`, `guest@acme.example`) — `kind GUEST`, no hats.
- Demands: at least one in each `DemandStatus` (incl. one `CONVERTED` with its
  Change), one raised by each client guest.
- Incidents: one in each `IncidentStatus`, one overdue, one raised by a guest,
  one `FIXES`-linked to a change.
- Changes: one in each `ChangeStatus` incl. `ROLLED_BACK`; one standard
  (1-step approval), one high-risk (2-step), one showing a single-approver
  override in its decision log; one linked to an originating demand; one
  `EMERGENCY` type.
- Notifications + a couple of `EmailOutbox` rows (`SENT` and one `FAILED`).
- Audit events fall out naturally from routing the seed through the module
  services (preferred) rather than raw inserts, so the every-state data is also
  a smoke test of the services.

---

## 7. CI pipeline

One workflow, sequential jobs sharing a build cache; merge blocked on any
failure:

1. `install` — `pnpm install --frozen-lockfile`.
2. `lint` — `eslint` (incl. the import-boundary rules) + `prettier --check`.
3. `typecheck` — `tsc --noEmit`.
4. `test` — `vitest run --coverage` against a `postgres:16` service; coverage
   thresholds enforced on the mandated paths (auth, RBAC/scoping, approvals,
   audit, demand→change) — job fails if any drops below target.
5. `migrations` — on a scratch DB, for each migration: `up → down → up`; fail
   if any migration has no working down step.
6. `build` — `next build` + `docker build`.
7. `e2e` — `playwright test` against the built image + compose DB (seeded).
8. `helm` — `helm lint` + `helm template` schema check.
9. `kind` — create a `kind` cluster, load the image, `helm install`, wait for
   the migrate hook + rollout, `curl /api/readyz` (expect 200), run a scripted API
   smoke (login → create a demand → read it back), `helm uninstall`.

---

## 8. Test plan (RED first where applicable)

- `/api/healthz` 200 always; `/api/readyz` 503 when the DB is down and when a
  migration is pending, 200 when healthy (integration test toggling a fake
  pending migration).
- `/metrics` exposes the named counters and they move (login increments
  `keel_auth_logins_total`).
- Seed is idempotent: run twice, row counts stable, no unique-constraint error.
- `helm template` with each value file produces valid manifests; the migrate
  Job carries the hook annotations; no rendered manifest contains a secret
  literal (grep gate).
- `kind` smoke is itself the deploy test — green means install + migrate +
  serve works from scratch.

---

## 9. Definition of done

`docker compose up` + `pnpm seed` gives a working, populated app locally with
Mailpit catching mail. `helm install` on a fresh `kind` cluster runs the
migration hook and serves a ready app. CI runs every gate in §7 and blocks
merge on any red. The README documents run, seed, per-role login, and deploy.
