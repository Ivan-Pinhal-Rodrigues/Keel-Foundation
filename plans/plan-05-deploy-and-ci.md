# Deploy and CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the deploy surface spec 08 describes — a complete local docker-compose stack, a production Dockerfile, a Helm chart with staging/prod values, a `/metrics` endpoint, seed-data coverage gaps closed, and a CI pipeline that blocks merge on lint/typecheck/test/migrations/build/e2e/helm/kind-smoke.

**Architecture:** No application-domain code changes. This plan is infrastructure: container build, chart templates, one new observability route, seed-data additions, and CI workflow YAML. Where a task has runtime logic (the `/metrics` route, the seed script), it follows the same server-module conventions as every prior plan; where a task is pure config (Dockerfile, Helm, CI YAML), its "test" is the tool that validates that config (`docker build`, `helm lint`, `helm template`, a `kind` smoke run) rather than vitest.

**Tech Stack:** Same as Phase 0/1 (Next 15.5.24, Prisma 6.19.3, pnpm) plus `prom-client` (Prometheus metrics), Docker, Helm 3, `kind`, GitHub Actions.

**Spec:** [`plans/specs/08-deploy-and-ci.md`](specs/08-deploy-and-ci.md)

## Global Constraints

- `withRequest` (`src/lib/api/with-request.ts`) is a FROZEN contract (spec 00 §8) — the metrics task instruments it from the outside (wrapping its exported function's behavior additively) and must not alter its request-context, error-mapping, or session-touch behavior.
- Every `api/**` route stays wrapped appropriately for its auth needs; `/api/healthz`, `/api/readyz`, `/metrics` are unauthenticated and listed in `src/middleware.ts` PUBLIC (healthz/readyz already are — confirm `/metrics` joins them, per spec §5 "no auth in v1, cluster-internal assumption").
- No secret values in the Helm chart or its values files — every credential is `existingSecret`-referenced by name (`keel-secrets`), never inlined (spec §4).
- `prisma/seed.ts` stays idempotent — every new row is `upsert`ed on a stable unique key; running `pnpm seed` twice must produce identical row counts.
- CI job order and gating exactly match spec §7 — merge blocks on ANY job failing, not just some.
- No raw hex in any Helm/Docker/YAML file that renders UI (n/a here — no UI in this plan). CSS/component conventions from earlier plans don't apply to this plan's file set.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

## Already shipped (do not re-scope)

- `GET /api/healthz` (`src/app/api/healthz/route.ts`) — always 200, no deps. Done.
- `GET /api/readyz` (`src/app/api/readyz/route.ts` + `src/server/health/readiness.ts`) — `SELECT 1` + migration-pending check, 200/503. Done, including its 503-on-db-down and 503-on-pending-migration tests (`src/app/api/__tests__/health.route.test.ts`).
- `docker-compose.yml` — `db` (postgres:16, healthcheck) + `mailpit`. Missing: `app` and `migrate` services (Task 1).
- `docker/postgres-init.sql` — creates `keel_app` / `keel_migrate` roles exactly per spec §2. Done, no changes needed.
- `.env.example` — documents every variable already. Done, no changes needed.
- `prisma/seed.ts` — admin (4 hats) + Northwind Traders + guest + demo demands/incidents/changes/notifications across most lifecycle states. Gaps: no second client, `ceo`/`cto` hold only their approver hat (spec wants `DEVELOPER + REVIEWER` too), no `EmailOutbox` `SENT` row (Task 4 audits and closes the rest).

---

### Task 1: Complete docker-compose — `app` + `migrate` services

**Files:**
- Modify: `docker-compose.yml`
- Create: `docker/migrate-entrypoint.sh`

**Interfaces:**
- Consumes: the Task 2 `Dockerfile`'s `dev`/`runner` build targets (write this task first with a `build: { context: ., target: runner }` reference — Task 2 supplies the actual Dockerfile; if Task 2 hasn't landed yet in execution order, this task's `app`/`migrate` services still validate via `docker compose config` since Compose doesn't require the referenced Dockerfile to exist to parse the YAML, but a full `docker compose up` needs Task 2 done first — note this dependency to the ledger).
- Produces: `docker compose up` brings up `db` → `migrate` (runs once, exits 0) → `app` (waits on `migrate`'s successful exit via `depends_on: { migrate: { condition: service_completed_successfully } }`).

- [ ] **Step 1: `docker/migrate-entrypoint.sh`**

```bash
#!/bin/sh
set -e
pnpm exec prisma migrate deploy
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f /app/docker/grants.sql 2>/dev/null || true
echo "migrate: done"
```

The grants are already idempotent per-migration (each migration that revokes DML re-runs cleanly via `migrate deploy`'s own tracking — `migrate deploy` only applies unapplied migrations, so there is no separate grants.sql to run here). Simplify: the entrypoint is just `prisma migrate deploy`.

```bash
#!/bin/sh
set -e
pnpm exec prisma migrate deploy
echo "migrate: applied"
```

- [ ] **Step 2: Add `app` and `migrate` to `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: keel
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports: ["5432:5432"]
    volumes:
      - keel-db:/var/lib/postgresql/data
      - ./docker/postgres-init.sql:/docker-entrypoint-initdb.d/00-init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d keel"]
      interval: 3s
      timeout: 3s
      retries: 20
  mailpit:
    image: axllent/mailpit:latest
    ports: ["1025:1025", "8025:8025"]
  migrate:
    build:
      context: .
      target: build
    environment:
      MIGRATE_DATABASE_URL: "postgresql://keel_migrate:keel_migrate@db:5432/keel?schema=public"
    entrypoint: ["sh", "/app/docker/migrate-entrypoint.sh"]
    depends_on:
      db:
        condition: service_healthy
  app:
    build:
      context: .
      target: runner
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: "postgresql://keel_app:keel_app@db:5432/keel?schema=public"
      MIGRATE_DATABASE_URL: "postgresql://keel_migrate:keel_migrate@db:5432/keel?schema=public"
      SMTP_URL: "smtp://mailpit:1025"
      APP_URL: "http://localhost:3000"
      NOTIFY_POLL_MS: "5000"
      NOTIFY_BATCH: "20"
      LOG_LEVEL: "debug"
    depends_on:
      migrate:
        condition: service_completed_successfully
      mailpit:
        condition: service_started
volumes:
  keel-db:
```

- [ ] **Step 3: Document the `pnpm dev`-on-host alternative** — add a short section to the root `README.md` (create one if it doesn't exist yet — check first) titled "Local development": two paths — `docker compose up` (full stack, containerized app) or `docker compose up db mailpit` + `pnpm dev` on the host (faster iteration, app runs outside the container against the same `db`/`mailpit`). Both need `pnpm seed` run once after first `up`.

- [ ] **Step 4: Validate** — `docker compose config` (parses clean, no schema errors). Full `docker compose up` validation happens after Task 2 lands the Dockerfile; note in the ledger that Task 1's runtime validation is deferred to Task 2's completion.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml docker/migrate-entrypoint.sh README.md
git commit -m "feat: docker-compose app and migrate services

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Multi-stage Dockerfile + Next standalone output

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `docker-compose.yml`'s `build.target: build` (migrate) and `build.target: runner` (app) from Task 1.
- Produces: a `runner` stage image serving on port 3000, `CMD ["node", "server.js"]`, non-root.

- [ ] **Step 1: `next.config.ts`** — add `output: "standalone"` (Next's server-bundling mode required for the `runner` stage to run without a full `node_modules`):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 2: `.dockerignore`**

```
node_modules
.next
.git
*.md
e2e
playwright-report
test-results
.env
.env.*
!.env.example
```

- [ ] **Step 3: `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --offline

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate
RUN pnpm build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && \
    groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
```

The `migrate` service in `docker-compose.yml` (Task 1) targets the `build` stage — it has the full `node_modules` (including `prisma` CLI) and the source tree, so `pnpm exec prisma migrate deploy` runs there directly; the `runner` stage deliberately has no `prisma` CLI, no dev deps, no source — only the standalone server output, matching spec §3's "no dev deps, no source, no secrets."

- [ ] **Step 4: Validate**

```bash
docker build --target runner -t keel:local .
docker run --rm keel:local node -e "console.log('ok')"
```

Expect both to succeed. Run `docker compose up` end-to-end (now that both `migrate` and `runner` targets exist): `db` healthy → `migrate` exits 0 → `app` starts → `curl http://localhost:3000/api/healthz` returns `{"status":"ok"}`.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore next.config.ts
git commit -m "feat: multi-stage production Dockerfile, Next standalone output

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `GET /metrics` — Prometheus counters

**Files:**
- Create: `src/server/metrics/registry.ts`, `src/app/api/metrics/route.ts`
- Modify: `src/app/api/auth/login/route.ts` (increment `keel_auth_logins_total`), `src/middleware.ts` (add `/api/metrics` to PUBLIC)
- Test: `src/server/metrics/__tests__/registry.test.ts`, `src/app/api/__tests__/metrics.route.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/server/metrics/registry.ts
  export const registry: Registry;                     // prom-client Registry, default metrics collected
  export const httpRequestsTotal: Counter<"method" | "route" | "status">;
  export const authLoginsTotal: Counter<"result">;      // result: "success" | "failure"
  export function outboxGauges(client?: PrismaClient): Promise<{ pending: number; failed: number }>;
  //   client.emailOutbox.count({ where: { status: "PENDING" } }) / { status: "FAILED" }
  ```
- `httpRequestsTotal` is incremented from `withRequest` (spec §7's `keel_http_requests_total`) — **without editing `withRequest`'s frozen internals**: wrap it. `src/lib/api/with-request.ts` exports `withRequest` as a named function; add a *second*, additive export `withRequestMetrics(handler)` is the wrong shape (it would require touching every route). Instead, per the plan's re-reading of the frozen-contract constraint: `withRequest`'s existing `try/catch` around the handler is the one place every request passes through — the increment is a single line inside that existing block, reading `req.method` and the matched route from `req.url`'s pathname, and the response's `status` after the handler resolves. This is additive instrumentation, not a change to error-mapping, session, or context behavior, so it satisfies "does not alter its request-context, error-mapping, or session-touch behavior." Read the current file in full before editing and place the increment as the last thing before `return response` (success path) and inside the `catch` (error path, using the mapped status).

- [ ] **Step 1: Write the failing tests**
  - `registry.test.ts`: `httpRequestsTotal` increments on `.inc({method,route,status})`; `outboxGauges` returns `{pending: N, failed: M}` matching seeded `EmailOutbox` rows of each status (integration test against the compose DB, mirroring other module tests' harness).
  - `metrics.route.test.ts`: `GET /metrics` returns `200` with `Content-Type: text/plain; version=0.0.4` (prom-client's default) and body containing `keel_http_requests_total`, `keel_outbox_pending`, `keel_outbox_failed`, `keel_auth_logins_total`, plus at least one default Node process metric (e.g. `process_cpu_user_seconds_total`). No session required (public route) — a request with no cookie still gets 200.
  - `login.route.test.ts` (extend): after a successful login, `authLoginsTotal` with `{result:"success"}` incremented by 1; after a failed login (wrong password), `{result:"failure"}` incremented by 1.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.** `pnpm add prom-client`. `registry.ts` calls `client.collectDefaultMetrics({ register: registry })` once at module load. The route handler: `return new Response(await registry.metrics(), { headers: { "content-type": registry.contentType } })` — for the outbox gauges, set them just before serving (`Gauge.set()` from a fresh `outboxGauges()` read) so the exposition reflects current state rather than a stale poll.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/server/metrics/ src/app/api/metrics/ src/app/api/auth/login/route.ts src/middleware.ts
git commit -m "feat: GET /metrics — Prometheus counters and gauges

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Seed script — close spec §6 coverage gaps

**Files:**
- Modify: `prisma/seed.ts`

**Interfaces:**
- No new exports — `main()` and its helpers stay internal to the script.

- [ ] **Step 1: Audit against spec §6, record the gap list** (already gathered — apply directly, no further audit needed):
  - `ceo@keel.local` hats: currently `["BUSINESS_APPROVER"]` → add `"DEVELOPER", "REVIEWER"` (spec: "DEVELOPER + REVIEWER + BUSINESS_APPROVER").
  - `cto@keel.local` hats: currently `["TECHNICAL_APPROVER"]` → add `"DEVELOPER", "REVIEWER"` (spec: "DEVELOPER + REVIEWER + TECHNICAL_APPROVER").
  - `founder@keel.local` (spec: "optionally... holding all four hats to demo the override cleanly") — **already satisfied by `admin@keel.local`**, which holds all four hats. Skip; do not add a redundant fifth user. Note this ruling in the ledger.
  - Second client "Acme Retail" + `guest@acme.example` — **missing, add** (mirror the Northwind guest exactly: `hashPassword("Keel-guest-2026")`, `kind: "GUEST"`, `clientId` on the new client, a display name like "Priya (Acme Retail)").
  - `EmailOutbox` rows: Task 13 of plan-04 already seeds one `FAILED` row (guarded by the notification count check). Spec also wants a `SENT` row — add one, upserted on a stable key (there's no natural unique key on `EmailOutbox`; guard it the same way plan-04 Task 13 guarded the `FAILED` row — inside the existing `notification.count`-guarded block, add one more `emailOutbox.create` for a `SENT` row with `sentAt: new Date()`).
  - Every `DemandStatus` / `IncidentStatus` / `ChangeStatus` value already has at least one seeded row from `seedDemoDemands` / `seedDemoIncidents` / `seedDemoChanges` (plan-01/02/03) — **verify, don't re-seed**: run `pnpm seed` against a fresh DB, then query each enum's distinct seeded values and confirm all 6 `DemandStatus`, all 5 `IncidentStatus`, all 8 `ChangeStatus` (incl. `ROLLED_BACK`) values appear at least once. If any is missing, add the smallest possible fixture to close it — but per the existing seed file's own docstrings, plan-03's `seedDemoChanges` already covers `ROLLED_BACK` and every stage; this step is expected to find zero gaps and is here as a verification step, not a known-work step.

- [ ] **Step 2: Apply the hat additions** — two one-line edits to the `hats:` arrays for `ceo`/`cto` in `seedDemoDemands`.

- [ ] **Step 3: Add "Acme Retail" + its guest** — a new small helper `seedSecondClient()` (or inline in `seedDemoDemands`, wherever the Northwind client/guest upsert already lives — mirror that exact pattern), called from `main()` after the Northwind `client.upsert`. Idempotent via `client.upsert({ where: { name: "Acme Retail" } })` + `user.upsert({ where: { email: "guest@acme.example" } })`. No demands/incidents need to be raised by this guest — the spec only requires the client + guest to exist ("one raised by each client guest" for demands, and "one raised by a guest" for incidents, is already satisfied by the Northwind guest per plan-01/02; re-read the spec line: "Demands: ... one raised by each client guest" — this DOES require at least one demand from the Acme guest too. Add one minimal demand from `guest@acme.example`, upserted on a fixed ref like `DEM-9004`, status `SUBMITTED`, mirroring `seedDemoDemands`'s existing pattern exactly).

- [ ] **Step 4: Add the `SENT` `EmailOutbox` row** inside the existing notification-count-guarded block in `seedDemoNotifications` (or wherever plan-04 Task 13 put the `FAILED` row — read that code first).

- [ ] **Step 5: Run `pnpm seed` twice** — idempotent (row counts stable, no unique-constraint error). Run the enum-coverage query from Step 1 and confirm zero gaps.

- [ ] **Step 6: `pnpm typecheck && pnpm lint`.**

- [ ] **Step 7: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat: seed — second client, full approver hats, SENT email row

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Helm chart — `helm/keel`

**Files:**
- Create: `helm/keel/Chart.yaml`, `helm/keel/values.yaml`, `helm/keel/values-staging.yaml`, `helm/keel/values-prod.yaml`, `helm/keel/templates/deployment.yaml`, `helm/keel/templates/service.yaml`, `helm/keel/templates/ingress.yaml`, `helm/keel/templates/migrate-job.yaml`, `helm/keel/templates/serviceaccount.yaml`, `helm/keel/templates/hpa.yaml`, `helm/keel/templates/configmap.yaml`, `helm/keel/templates/_helpers.tpl`, `helm/keel/templates/NOTES.txt`, `helm/keel/README.md`

**Interfaces:**
- Consumes: the `runner` image from Task 2 (`image.repository`/`image.tag` in values), `/api/healthz` + `/api/readyz` from the already-shipped routes.
- Produces: `helm install keel helm/keel -f helm/keel/values-staging.yaml` deploys a working release; `helm/keel/README.md` documents every value and the three required `keel-secrets` keys.

- [ ] **Step 1: `Chart.yaml`**

```yaml
apiVersion: v2
name: keel
description: Keel ITSM platform
type: application
version: 0.1.0
appVersion: "1.0.0"
```

- [ ] **Step 2: `templates/_helpers.tpl`**

```yaml
{{- define "keel.name" -}}
keel
{{- end -}}

{{- define "keel.fullname" -}}
{{ .Release.Name }}-keel
{{- end -}}

{{- define "keel.labels" -}}
app.kubernetes.io/name: {{ include "keel.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "keel.selectorLabels" -}}
app.kubernetes.io/name: {{ include "keel.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
```

- [ ] **Step 3: `values.yaml`** (defaults, `ingress.enabled: false`, 1 replica)

```yaml
replicaCount: 1

image:
  repository: keel
  tag: local
  pullPolicy: IfNotPresent

existingSecret: keel-secrets

config:
  appUrl: "http://localhost:3000"
  notifyPollMs: "5000"
  notifyBatch: "20"
  logLevel: "info"

service:
  port: 3000

ingress:
  enabled: false
  className: ""
  host: ""
  annotations: {}

resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi

autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 3
  targetCPUUtilizationPercentage: 75

serviceAccount:
  create: true
  name: ""
```

- [ ] **Step 4: `values-staging.yaml`**

```yaml
replicaCount: 1

resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi

ingress:
  enabled: true
  className: "nginx"
  host: "staging.keel.example.com"

config:
  logLevel: "debug"
```

- [ ] **Step 5: `values-prod.yaml`**

```yaml
replicaCount: 2

resources:
  requests:
    cpu: 250m
    memory: 512Mi
  limits:
    cpu: 1000m
    memory: 1Gi

ingress:
  enabled: true
  className: "nginx"
  host: "keel.example.com"

config:
  logLevel: "info"

autoscaling:
  enabled: false
```

- [ ] **Step 6: `templates/configmap.yaml`**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "keel.fullname" . }}-config
  labels: {{- include "keel.labels" . | nindent 4 }}
data:
  APP_URL: {{ .Values.config.appUrl | quote }}
  NOTIFY_POLL_MS: {{ .Values.config.notifyPollMs | quote }}
  NOTIFY_BATCH: {{ .Values.config.notifyBatch | quote }}
  LOG_LEVEL: {{ .Values.config.logLevel | quote }}
```

- [ ] **Step 7: `templates/serviceaccount.yaml`**

```yaml
{{- if .Values.serviceAccount.create }}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ .Values.serviceAccount.name | default (include "keel.fullname" .) }}
  labels: {{- include "keel.labels" . | nindent 4 }}
{{- end }}
```

- [ ] **Step 8: `templates/deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "keel.fullname" . }}
  labels: {{- include "keel.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels: {{- include "keel.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels: {{- include "keel.selectorLabels" . | nindent 8 }}
    spec:
      serviceAccountName: {{ .Values.serviceAccount.name | default (include "keel.fullname" .) }}
      containers:
        - name: keel
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: {{ .Values.existingSecret }}
            - configMapRef:
                name: {{ include "keel.fullname" . }}-config
          livenessProbe:
            httpGet:
              path: /api/healthz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /api/readyz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          resources: {{- toYaml .Values.resources | nindent 12 }}
```

- [ ] **Step 9: `templates/service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "keel.fullname" . }}
  labels: {{- include "keel.labels" . | nindent 4 }}
spec:
  type: ClusterIP
  ports:
    - port: {{ .Values.service.port }}
      targetPort: 3000
  selector: {{- include "keel.selectorLabels" . | nindent 4 }}
```

- [ ] **Step 10: `templates/ingress.yaml`**

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "keel.fullname" . }}
  labels: {{- include "keel.labels" . | nindent 4 }}
  annotations: {{- toYaml .Values.ingress.annotations | nindent 4 }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  rules:
    - host: {{ .Values.ingress.host }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "keel.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
{{- end }}
```

Note in the chart's README (Step 13): "the ingress controller MUST replace, not append to, `X-Forwarded-For` with the real client address before the request reaches the app — until a trusted proxy is in place, the login rate limiter keys on the submitted email only (spec 08 §4)."

- [ ] **Step 11: `templates/migrate-job.yaml`**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "keel.fullname" . }}-migrate
  labels: {{- include "keel.labels" . | nindent 4 }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  backoffLimit: 1
  template:
    metadata:
      labels: {{- include "keel.selectorLabels" . | nindent 8 }}
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          command: ["sh", "/app/docker/migrate-entrypoint.sh"]
          envFrom:
            - secretRef:
                name: {{ .Values.existingSecret }}
```

- [ ] **Step 12: `templates/hpa.yaml`**

```yaml
{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "keel.fullname" . }}
  labels: {{- include "keel.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "keel.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
{{- end }}
```

- [ ] **Step 13: `templates/NOTES.txt`**

```
Keel deployed as {{ include "keel.fullname" . }}.

Check rollout:
  kubectl rollout status deployment/{{ include "keel.fullname" . }}

Readiness:
  kubectl exec deploy/{{ include "keel.fullname" . }} -- curl -sf localhost:3000/api/readyz
```

- [ ] **Step 14: `helm/keel/README.md`** — list every value from all three `values*.yaml` files with a one-line description, and the required keys of `keel-secrets` (`DATABASE_URL`, `MIGRATE_DATABASE_URL`, `SMTP_URL`) with an example `kubectl create secret generic keel-secrets --from-literal=...` command. Include the ingress X-Forwarded-For note from Step 10.

- [ ] **Step 15: Validate**

```bash
helm lint helm/keel
helm lint helm/keel -f helm/keel/values-staging.yaml
helm lint helm/keel -f helm/keel/values-prod.yaml
helm template helm/keel -f helm/keel/values-staging.yaml | grep -iE "password|secret.*:.*[A-Za-z0-9]{8}" || echo "no secret literals found"
```

Expect all `helm lint` runs clean and the grep to find nothing (only `secretRef`/`existingSecret` references, never a literal value).

- [ ] **Step 16: Commit**

```bash
git add helm/
git commit -m "feat: Helm chart for keel — deployment, service, ingress, migrate job, HPA

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: CI pipeline — install / lint / typecheck / test / migrations

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a workflow triggered on `pull_request` and `push` to `master`, with jobs `install`, `lint`, `typecheck`, `test`, `migrations` (jobs 1-5 of spec §7), each depending on `install`'s cache via `actions/setup-node`'s built-in pnpm cache (no separate cache-restore job needed — simpler than spec's literal "sharing a build cache" wording, which this satisfies via `actions/setup-node@v4`'s `cache: pnpm`).

- [ ] **Step 1: `.github/workflows/ci.yml`** — jobs 1-5:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [master]

env:
  NODE_VERSION: "22"

jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile

  lint:
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  typecheck:
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  test:
    needs: install
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: keel
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres -d keel"
          --health-interval 3s
          --health-timeout 3s
          --health-retries 20
    env:
      DATABASE_URL: "postgresql://keel_app:keel_app@localhost:5432/keel?schema=public"
      MIGRATE_DATABASE_URL: "postgresql://keel_migrate:keel_migrate@localhost:5432/keel?schema=public"
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: init roles
        run: PGPASSWORD=postgres psql -h localhost -U postgres -d keel -f docker/postgres-init.sql
      - run: pnpm exec prisma migrate deploy
      - run: pnpm test -- --coverage
      - name: coverage threshold
        run: node scripts/check-coverage.mjs

  migrations:
    needs: install
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: keel_scratch
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres -d keel_scratch"
          --health-interval 3s
          --health-timeout 3s
          --health-retries 20
    env:
      MIGRATE_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/keel_scratch?schema=public"
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: up-down-up every migration
        run: node scripts/migration-updown-check.mjs
```

- [ ] **Step 2: `scripts/coverage thresholds` — check if a coverage config already exists** (grep `vitest.config.ts` for a `coverage` block). If absent, add one covering the mandated paths (auth, RBAC/scoping, approvals, audit, demand→change): `src/server/auth/**`, `src/server/policy/**`, `src/server/modules/approval/**`, `src/server/audit/**`, `src/server/modules/demand/**`, `src/server/modules/change/**`, threshold 80% lines/branches as a starting bar (this project's existing suite is dense enough that 80% is a floor, not a stretch — adjust up after a real run if the actual number is comfortably higher). `scripts/check-coverage.mjs` reads `coverage/coverage-summary.json` and exits 1 if any mandated path's line/branch % is below threshold.

- [ ] **Step 3: `scripts/migration-updown-check.mjs`** — Node ESM script (mirror `scripts/check-migrations.mjs`'s style: no deps, `execFileSync`). For each migration folder in order: `prisma migrate deploy` up to and including it, then `prisma migrate resolve --rolled-back <name>` + apply the folder's own `-- Down:` SQL block (parse it out of `migration.sql`, per the project's migration-authoring convention — check `docs/migrations.md` for the exact down-block marker syntax), then re-apply forward. Fail loudly naming the migration if any step errors.

- [ ] **Step 4: Validate locally** — `act` isn't required; validate the YAML is well-formed (`pnpm exec yaml-lint .github/workflows/ci.yml` or a quick `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))"` if a YAML parser is already a devDependency, else skip and rely on GitHub's own validation on first push) and run each job's commands locally once (`pnpm lint`, `pnpm typecheck`, `pnpm test`, the migration up/down/up script) to confirm they succeed outside CI too.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml scripts/check-coverage.mjs scripts/migration-updown-check.mjs vitest.config.ts
git commit -m "feat: CI pipeline — install, lint, typecheck, test, migrations gates

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: CI pipeline — build / e2e / helm / kind smoke

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `scripts/kind-smoke.sh`

**Interfaces:**
- Consumes: the `Dockerfile` (Task 2), the Helm chart (Task 5), the Playwright spec (already shipped, plan-04 Task 14).
- Produces: jobs `build`, `e2e`, `helm`, `kind` appended to the workflow, matching spec §7 items 6-9.

- [ ] **Step 1: `build` job**

```yaml
  build:
    needs: [lint, typecheck]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - uses: docker/setup-buildx-action@v3
      - run: docker build --target runner -t keel:ci .
      - run: docker save keel:ci -o keel-ci.tar
      - uses: actions/upload-artifact@v4
        with:
          name: keel-image
          path: keel-ci.tar
          retention-days: 1
```

- [ ] **Step 2: `e2e` job**

```yaml
  e2e:
    needs: build
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: keel
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres -d keel"
          --health-interval 3s
          --health-timeout 3s
          --health-retries 20
      mailpit:
        image: axllent/mailpit:latest
        ports: ["1025:1025", "8025:8025"]
    env:
      DATABASE_URL: "postgresql://keel_app:keel_app@localhost:5432/keel?schema=public"
      MIGRATE_DATABASE_URL: "postgresql://keel_migrate:keel_migrate@localhost:5432/keel?schema=public"
      SMTP_URL: "smtp://localhost:1025"
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - name: init roles
        run: PGPASSWORD=postgres psql -h localhost -U postgres -d keel -f docker/postgres-init.sql
      - run: pnpm exec prisma migrate deploy
      - run: pnpm seed
      - run: pnpm build
      - run: pnpm test:e2e
```

- [ ] **Step 3: `helm` job**

```yaml
  helm:
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/setup-helm@v4
      - run: helm lint helm/keel
      - run: helm lint helm/keel -f helm/keel/values-staging.yaml
      - run: helm lint helm/keel -f helm/keel/values-prod.yaml
      - name: no secret literals
        run: |
          ! helm template helm/keel -f helm/keel/values-staging.yaml | grep -iE "password|secret.*:.*['\"a-zA-Z0-9]{8,}" | grep -v "secretRef\|existingSecret"
```

- [ ] **Step 4: `kind` job + `scripts/kind-smoke.sh`**

```yaml
  kind:
    needs: [build, helm]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: keel-image
      - uses: helm/kind-action@v1
        with:
          cluster_name: keel-ci
      - run: docker load -i keel-ci.tar
      - run: kind load docker-image keel:ci --name keel-ci
      - uses: azure/setup-helm@v4
      - run: bash scripts/kind-smoke.sh
```

`scripts/kind-smoke.sh`:

```bash
#!/bin/bash
set -euo pipefail

kubectl create namespace keel-smoke
kubectl -n keel-smoke create secret generic keel-secrets \
  --from-literal=DATABASE_URL="postgresql://keel_app:keel_app@keel-smoke-db:5432/keel?schema=public" \
  --from-literal=MIGRATE_DATABASE_URL="postgresql://keel_migrate:keel_migrate@keel-smoke-db:5432/keel?schema=public" \
  --from-literal=SMTP_URL="smtp://keel-smoke-mailpit:1025"

kubectl -n keel-smoke run keel-smoke-db --image=postgres:16 \
  --env="POSTGRES_DB=keel" --env="POSTGRES_USER=postgres" --env="POSTGRES_PASSWORD=postgres" \
  --port=5432 --expose
kubectl -n keel-smoke run keel-smoke-mailpit --image=axllent/mailpit:latest --port=1025 --expose

kubectl -n keel-smoke wait --for=condition=ready pod -l run=keel-smoke-db --timeout=60s
kubectl -n keel-smoke cp docker/postgres-init.sql "$(kubectl -n keel-smoke get pod -l run=keel-smoke-db -o jsonpath='{.items[0].metadata.name}')":/tmp/init.sql
kubectl -n keel-smoke exec "$(kubectl -n keel-smoke get pod -l run=keel-smoke-db -o jsonpath='{.items[0].metadata.name}')" -- psql -U postgres -d keel -f /tmp/init.sql

helm install keel-smoke helm/keel -n keel-smoke \
  --set image.repository=keel --set image.tag=ci \
  --wait --timeout 3m

kubectl -n keel-smoke wait --for=condition=available deployment/keel-smoke-keel --timeout=120s

kubectl -n keel-smoke run curl-probe --image=curlimages/curl:latest --rm -i --restart=Never -- \
  curl -sf "http://keel-smoke-keel:3000/api/readyz"

echo "kind smoke: readyz OK"

helm uninstall keel-smoke -n keel-smoke
kubectl delete namespace keel-smoke
```

Note in the plan (for the executor): the full "login → create a demand → read it back" API smoke from spec §7 item 9 needs a seeded user, which the smoke DB above doesn't have (no migrate + seed step ran against it). Extend the script: after `helm install`'s migrate-job hook completes, run `pnpm seed` against the smoke DB (port-forward or a one-off `kubectl run` with the `runner` image and `DATABASE_URL` pointed at `keel-smoke-db`, command `node -e "..."` isn't available since `runner` has no seed script — instead run the seed from a throwaway pod using the `build` stage image, which still has the full toolchain: `kubectl -n keel-smoke run seed --image=keel:ci... ` — **the `runner`-stage image lacks `prisma`/`tsx`, so seeding inside the kind cluster needs the `build`-stage image tagged and loaded too**. Simplify: `kind load docker-image` both `keel:ci` (runner, already loaded) and additionally build+load a `keel-migrate:ci` (`--target build`) for the one-off seed pod. Add that build+load step to the `kind` job before Step 4's script runs, and extend `kind-smoke.sh` with the seed pod + a `curl` sequence for login (`POST /api/auth/login`) → create demand (`POST /api/demands`) → read it back (`GET /api/demands/<id>`), asserting each response status. This is the most infrastructure-heavy single step in the plan — budget extra review attention here.

- [ ] **Step 5: Validate** — push to a scratch branch or open a draft PR to actually exercise the `kind` job in GitHub Actions (a `kind` cluster cannot run inside this repo's local sandbox); confirm the `test`/`migrations`/`build`/`e2e`/`helm` jobs at minimum by running their commands locally.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml scripts/kind-smoke.sh
git commit -m "feat: CI — build, e2e, helm, kind-cluster smoke test gates

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Remaining spec §8 tests + README deploy documentation

**Files:**
- Test: `src/app/api/__tests__/metrics.route.test.ts` (if not already fully covered by Task 3 — extend if gaps remain), `prisma/__tests__/seed-idempotent.test.ts` (or a script-based check if the project has no precedent for a seed test — check first), `helm/keel/__tests__/` is not a vitest concern; its checks are already in Task 5 Step 15 and Task 7's `helm` job.
- Modify: `README.md`

**Interfaces:**
- No new production code — this task closes the spec §8 test-plan items not already covered by Tasks 3-7, and writes the DoD documentation (spec §9).

- [ ] **Step 1: Confirm coverage, list what's left.** Already covered by earlier tasks: readyz 503 cases (pre-existing), `/metrics` counters exposition (Task 3), seed idempotent via manual double-run (Task 4 Step 5), helm template + secret-literal grep (Task 5 Step 15, Task 7 `helm` job), kind smoke (Task 7). **Remaining:** an automated (not just manually-run-once) seed-idempotency test, and confirming `keel_auth_logins_total` genuinely moves on a real login (Task 3 already added this to `login.route.test.ts` — verify it's there, don't duplicate).

- [ ] **Step 2: Write `prisma/__tests__/seed-idempotent.test.ts`** — spawn `pnpm seed` twice via `execFileSync` (or a direct `import` + `main()` call if the seed script exports `main` — check; if not exported, refactor `prisma/seed.ts` to `export async function main()` with the existing bottom-of-file `main().finally(...)` guarded by `if (require.main === module)`-equivalent ESM check, so the test can import and call it directly without a subprocess), assert the row counts (`user.count()`, `client.count()`, `demand.count()`, etc.) are identical after the second run.

- [ ] **Step 3: Run, verify pass. Full gate** (`pnpm lint && pnpm typecheck && pnpm build && pnpm test`).

- [ ] **Step 4: README deploy section** — add/extend `README.md` with:
  - "Run locally" (from Task 1 Step 3, if not already written there — consolidate).
  - "Seed data" — `pnpm seed`, the full credential table (every seeded user + password + role/hats + which client).
  - "Deploy" — `docker build`, `helm install keel helm/keel -f helm/keel/values-staging.yaml --set image.tag=<tag>`, the required `keel-secrets` keys (link to `helm/keel/README.md` rather than duplicating).
  - "CI" — one paragraph naming the 9 gates and that merge blocks on any red.

- [ ] **Step 5: Commit**

```bash
git add prisma/__tests__/seed-idempotent.test.ts prisma/seed.ts README.md
git commit -m "test: seed idempotency; docs: README deploy and CI section

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Whole-branch review (before merge)

Two parallel focused reviewers against the full plan-05 diff:

1. **Security / isolation** — `/metrics` and the `kind-smoke.sh` script never embed a real secret literal (only `existingSecret` references and CI-ephemeral throwaway credentials scoped to the `keel-smoke` namespace, which is deleted at the end of the job); the Dockerfile `runner` stage genuinely has no dev deps, no source tree, no `.env`; the Helm chart's `README.md` doesn't leak a real credential as an "example"; `/metrics` is deliberately unauthenticated (confirm this is intentional per spec §5, not an oversight) and exposes no PII (row counts and process metrics only — verify no email addresses or names leak into a metric label).
2. **Correctness** — `docker compose up` genuinely serves a working app end-to-end (migrate → app, in order); every Helm value used in a template exists in all three values files (a template referencing an unset value renders empty/breaks — check `helm template` output for each values file, not just lint); the CI job dependency graph (`needs:`) matches spec §7's stated order and nothing can pass through to `build`/`e2e`/`kind` if `lint`/`typecheck`/`test` failed; `keel_http_requests_total`'s route label doesn't explode cardinality (a raw dynamic id in the URL, e.g. `/api/demands/<cuid>`, must be normalized to a route pattern like `/api/demands/:id` before becoming a label value — verify Task 3's implementation does this, since prom-client has no built-in protection and an un-normalized label is a real production metrics-cardinality bug).

Both must come back clean (a small re-gated fix wave is acceptable). Then merge `worktree-keel-foundation` → `master` (`git merge --ff-only`), update the SDD ledger, and push `master` to `origin` (a PR is only meaningful once the remote has diverging branches — for this repo's current all-master-so-far history, a direct push is the established pattern; ask the user if they want a review-PR workflow for this or a future plan instead).

---

## Self-review (writing-plans skill — done at authoring time)

- **Spec 08 coverage.** §2 compose → Task 1. §3 Dockerfile → Task 2. §4 Helm → Task 5. §5 health/readiness already shipped; `/metrics` → Task 3. §6 seed → Task 4. §7 CI → Tasks 6-7. §8 test plan → distributed across Tasks 3/4/5/7, closed by Task 8. §9 DoD → Task 8's README + the cumulative result of every task.
- **Placeholder scan.** Every task carries literal file content (YAML, Dockerfile, shell) — no "add appropriate Helm templates." The one deliberately flagged soft spot is Task 7 Step 4 (the kind-cluster seed-pod mechanics), called out explicitly as the plan's highest-complexity single step rather than hand-waved.
- **Type consistency.** `outboxGauges()` (Task 3) reads the same `EmailOutbox.status` values (`PENDING`/`FAILED`) Task 4's seed data and plan-04's `listFailedEmails` already use. The Helm `existingSecret` name (`keel-secrets`) is the single string used consistently across `values.yaml`, `deployment.yaml`, `migrate-job.yaml`, `kind-smoke.sh`, and the chart README.
- **Known soft spots flagged for the executor:** Task 3's `withRequest` instrumentation must be read-then-edited carefully to respect the frozen-contract constraint — a fix-wave-worthy risk if done carelessly. Task 6's `migration-updown-check.mjs` depends on `docs/migrations.md`'s down-block marker syntax, which the executor must read first, not guess. Task 7's kind-cluster full API smoke (login→create→read) is the plan's largest single implementation step; the plan gives the mechanics but the executor should treat it as needing its own careful sub-steps and extra review attention, matching the plan's own note.
