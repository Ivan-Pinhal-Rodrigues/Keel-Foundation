# Keel — Design

Keel is an ITIL-aligned IT service management platform for a two-person software
company (CEO + CTO) that also delivers software to external clients. It gives the
two internal users a controlled pipeline from client demand through triage,
change, and delivery, with a complete immutable audit trail. It gives client
users a scoped guest portal to submit demands, raise incidents against delivered
software, and track their own items.

This document is the master design. Each module has a detailed spec in
`plans/specs/`. Work follows the brief's workflow: this design →
`superpowers:writing-plans` → git worktree → TDD build with agent teams →
review → deploy.

The name `Keel` collides with `keel.sh` (a Kubernetes deployment tool). This was
raised in brainstorming and accepted. Package scope: `@keel/*`. Kubernetes
release name: `keel`.

---

## 1. Scope

### 1.1 V1 — this build

- Authentication, RBAC, guest row-level scoping, immutable audit log (in full).
- **Demand Management** — full. The reason the product exists.
- **Incident Management** — core lifecycle: report → assign → resolve → close;
  priority from impact × urgency; `dueAt` + `overdue` flag. Guests raise and
  track their own.
- **Change Management** — RFC → risk/impact assessment → approval →
  implementation window → mandatory rollback-plan field → post-implementation
  review. Links to the originating demand.
- **Approvals engine** — generic, multi-step, role-routed, records every decision
  with actor/time/reason, supports the single-approver override with typed
  justification. No delegation.
- **Dashboards** — per role: my queue, approvals waiting on me, overdue items,
  demand pipeline. Guest sees only their own client's items.
- **Notifications** — in-app + email on assignment, approval needed, status
  change, comment, and item-became-overdue.
- **Seed data** — CEO, CTO, two demo client organisations, sample demands /
  incidents / changes in every state.
- **Deploy** — docker compose for local; one Helm chart with staging + prod
  values; secrets external; health + readiness endpoints; structured logs.
- **Tests** — TDD throughout; enforced coverage on auth, RBAC / guest scoping,
  the approvals engine, the audit log, and the demand→change conversion path;
  Playwright E2E for the full client demand journey.

### 1.2 V1 simplifications (upgraded later)

- SLA is `dueAt` (derived from priority) + an `overdue` boolean. No
  business-hours calendar, no auto-pause.
- "Affected service" on an incident is a free-text field, not a CMDB link.
- Deploy is Helm + `helm upgrade`. No continuous-delivery controller.
- End-to-end TypeScript types via shared Zod schemas; no generated OpenAPI
  document.

### 1.3 V2 backlog — not built in V1

Service Request / Catalog · Problem Management · full SLA engine (calendars,
pause states, breach reporting) · CMDB (light) + CI linking · Knowledge base ·
approval delegation · GitOps (ArgoCD / Flux) · generated OpenAPI document ·
metrics dashboards · SSO · guest self-signup.

---

## 2. Stack

| Concern | Choice |
| --- | --- |
| Runtime | Node 22 LTS |
| Framework | Next.js 15 (App Router), React 19, TypeScript `strict` |
| Database | PostgreSQL 16 |
| ORM / migrations | Prisma 6, Prisma Migrate |
| Auth | Auth.js v5 (`next-auth@5`) + `@auth/prisma-adapter`, **database** session strategy |
| Password hashing | argon2id (`@node-rs/argon2`) |
| Validation | Zod — shared request/response schemas, server and client |
| Styling | Ported Flightdeck token stylesheet + CSS Modules; Radix UI **unstyled** primitives for dialog, dropdown, tabs, tooltip. No Tailwind, no component library. |
| Email | nodemailer, single SMTP transport; Mailpit locally |
| Logging | pino, structured JSON |
| Unit / integration tests | Vitest against a real PostgreSQL |
| E2E tests | Playwright |
| Package manager | pnpm; single package (not a monorepo) |
| Container | multi-stage Dockerfile, Next standalone output, non-root user |
| Orchestration | Helm chart (cluster-agnostic); `kind` in CI |

Exact patch versions are locked during `writing-plans` / Phase 0 and pinned in
`package.json` and the lockfile.

---

## 3. Architecture

### 3.1 Layout

```
src/
  middleware.ts             session resolution, route guarding
  app/
    (internal)/             CEO / CTO UI — overview, demands, incidents,
                            changes, approvals, audit
    portal/                 guest UI — my requests, my incidents, submit, detail
    api/**                  route handlers (thin)
  server/
    modules/
      demand/               service fns + state machine + serializers
      incident/
      change/
      approvals/
      notify/               emitNotification + outbox worker
    auth/                   Auth.js config, session helpers, guest invites
    policy/                 authorize(), scopeToClient()
    audit/                  writeAudit()
    db/                     Prisma client, transaction helpers
  lib/
    api/                    typed client + Zod schemas (the interface contract)
  components/               ported Flightdeck components, CSS Modules
  styles/
    tokens.css              ported Flightdeck :root token blocks (light + dark)
prisma/
  schema.prisma
  migrations/
helm/keel/
```

### 3.2 Layering rules

- **Route handlers** (`src/app/api/**`) are thin: parse and validate input with
  Zod, resolve the actor from the session, call `authorize()`, invoke a module
  service, serialize the result through a role-aware serializer. No business
  logic. No direct Prisma access for domain rules.
- **Module services** (`src/server/modules/<module>/`) own their tables and
  encode all business rules and state transitions. A mutating service function
  performs, in one transaction: the domain write, the `AuditEvent` insert, and
  the enqueue of any `Notification` / `EmailOutbox` rows.
- **Policy layer** exposes `authorize(actor, action, subject)` (deny by default)
  and `scopeToClient(actor)` (returns a Prisma `where` fragment for guest reads).
- **Audit** exposes the single `writeAudit(tx, event)` used by every module.
- **Notify** exposes `emitNotification(tx, spec)` and runs the outbox worker.
- eslint `no-restricted-imports` forbids `app/**` from importing Prisma directly
  and forbids cross-module imports except through a module's published
  `index.ts`.

### 3.3 Request lifecycle

1. `middleware.ts` resolves the session cookie → `Session` row → attaches
   `actorId`, or redirects (pages) / returns 401 (API).
2. The route handler loads the full actor (`kind`, `hats`, `clientId`) and
   validates the request body against its Zod schema.
3. `authorize(actor, action, subject)` throws `ForbiddenError` if not permitted.
4. For guest actors, the module read path composes `scopeToClient(actor)` into
   the query `where`.
5. The module service executes, writing domain + audit + notifications
   atomically.
6. The response is serialized through a role-aware serializer. Guest serializers
   omit internal fields and non-client-visible comments.

### 3.4 Authorization model

Authorisation is driven by `User.kind` (`INTERNAL` / `GUEST`) and, for internal
users, `User.hats`.

- **`DEVELOPER`** → create and work demands, incidents, changes; comment
  internally.
- **`REVIEWER`** → review a change's RFC and leave review comments (distinct
  from approving it).
- **`BUSINESS_APPROVER`** → score a demand's business value; make the worth
  decision; give business approval on a high-risk change; release go/no-go.
- **`TECHNICAL_APPROVER`** → score a demand's effort / feasibility; give
  technical approval on every change (CAB chair); security sign-off; administer
  sessions.
- **guest** (`kind = GUEST`, no hats) → submit a demand, raise an incident
  against delivered software, comment on and view items belonging to their own
  client organisation only.

One internal person may hold all four hats. Policy is expressed as pure
functions, one per action, fully unit-tested. There is no permission table in
v1 — the fixed `Hat` set does not warrant one.

**Segregation of duties.** A decision point is blocked on the normal path when
the actor is the subject's submitter or author, even if the actor holds the
required role. The actor may instead invoke a **single-approver override**: the
decision is recorded with `isSingleApproverOverride = true` and a required
free-text `overrideJustification` (min 20 chars); a dedicated `*.override` audit
event is written alongside the normal decision event; dashboards list every open
single-approver override.

This applies in two places, with the same rule and UX:
- **Approval-engine steps** (spec 04) — a `TECHNICAL_APPROVER` or
  `BUSINESS_APPROVER` step on a change where the actor is the change's owner.
  Event: `approval.override`.
- **Demand worth decisions** (spec 01) — the `PURSUE` / `PARK` / `DROP` call
  when the decider is the demand's submitter. A worth decision is not an
  `ApprovalRequest`, so this is enforced inline in the demand service. Event:
  `demand.decide.override`.

### 3.5 Guest scoping

- Every guest-visible table carries a nullable `clientId`. Client-originated
  items set it at creation, server-side, from the actor — the client cannot
  supply or change it.
- `scopeToClient(actor)` forces `clientId = actor.clientId` on all guest reads.
- Guest response serializers are separate from internal serializers and never
  include: internal comments, assignee identity (shown as "Keel team"),
  risk/impact internals, the change calendar, other clients, the CMDB, or the
  audit log.
- A guest requesting an item id that is not theirs receives **404**, not 403 —
  existence is not revealed. Negative tests assert this.

### 3.6 Auth.js database sessions with credentials — known risk + mitigation

The Auth.js v5 Credentials provider does not create a database session on its
own; it defaults to a JWT. For this build:

- The Credentials provider is used only to verify email + password (argon2id)
  and return a user id.
- A thin custom sign-in route wraps the sign-in and explicitly calls the Prisma
  adapter's `createSession`, then sets the session cookie — so a `Session` row
  always exists.
- `middleware.ts` and all server code resolve auth **only** by looking up the
  `Session` row. No JWT is trusted for authorisation.
- Integration test: after a successful login exactly one `Session` row exists
  for the user and the cookie resolves to it; after logout, zero.

**Contingency.** If this proves fragile in Phase 0, fall back to a
purpose-built session module (opaque token, `Session` table, `argon2id`
password verify) — the surface is small. `plans/specs/00-foundation.md` carries
both paths; the decision is recorded there before Phase 1 starts.

### 3.7 Audit log

- `AuditEvent` is append-only. A checked-in SQL migration grants the runtime DB
  role `INSERT, SELECT` only on the table; `UPDATE` / `DELETE` are never
  granted. Migrations run as a separate role with DDL rights.
- Every state transition in every module emits exactly one event:
  `{ actorId, action, subjectType, subjectId, at, payload, requestId }`.
  `requestId` ties all events from one HTTP request together.
- The audit UI (Phase 2) is a filterable table with CSV export, internal only.
- Completeness is tested per module: a transition that does not emit its event
  fails that module's suite.

### 3.8 Notifications

- **In-app**: `Notification` rows, surfaced in a topbar bell, marked read on
  view.
- **Email**: `EmailOutbox` rows drained by an interval worker that holds a
  PostgreSQL advisory lock, so exactly one sender is active across replicas.
  nodemailer SMTP transport; retry with exponential backoff; permanent failure
  after N attempts is logged and flagged on an internal dashboard tile.
- Triggers: assignment, approval needed, status change, comment, item became
  overdue.
- Local: Mailpit captures all mail. CI: the transport is mocked and the worker
  logic is tested directly.

---

## 4. Data model

**Canonical schema: [`specs/data-model.md`](specs/data-model.md).** That file is
the single source of truth for every table, field, and enum, and the shared
contract each module builds against. Module specs reference it; they do not
restate or diverge from it. This section holds only the policy that sits above
the schema.

### 4.1 Identity and authorisation shape

- `User.kind` ∈ `INTERNAL | GUEST`. `User.hats: Hat[]` — `DEVELOPER`,
  `REVIEWER`, `BUSINESS_APPROVER`, `TECHNICAL_APPROVER` — empty for a guest,
  any combination for an internal user (one person may hold all four).
- "CEO" and "CTO" name the two people, not roles in the schema. In the seed the
  CEO user holds `BUSINESS_APPROVER`, the CTO user holds `TECHNICAL_APPROVER`,
  and both hold `DEVELOPER` + `REVIEWER`. No code branches on "is the CEO" — it
  branches on hats.
- A guest is `kind = GUEST` with a non-null `clientId` and no hats.

### 4.2 Priority and SLA (v1)

Priority = impact × urgency per the matrix in `data-model.md`.
`dueAt = createdAt + { P1: 4h, P2: 24h, P3: 72h, P4: 168h }`.

`Incident.overdue` is stored (so it can be indexed and filtered) **and**
recomputed on every read and by the notification job, so a response is never
stale: `overdue = now > dueAt AND status ∉ {RESOLVED, CLOSED}`.
`Incident.overdueNotifiedAt` is a separate timestamp used only to fire the
overdue notification once (spec 02 §3). V1 SLA is this and nothing more — no
business-hours calendar, no "waiting for client" pause.

### 4.3 Migrations

- Prisma Migrate. Every migration is reviewed for a reversible down path and is
  data-preserving; irreversible steps are called out explicitly in the spec
  that introduces them.
- The audit-log grant restriction and the migration-role split are a
  checked-in raw SQL migration.
- Record-of-fact tables (`AuditEvent`, `ApprovalDecision`,
  `PostImplementationReview`) are append-only at the DB privilege level — the
  migration that creates such a table also `REVOKE`s `UPDATE, DELETE` from
  `keel_app`.
- The gate runs `check:migrations` (folder-name convention + every record-of-fact
  table verified non-mutable by the runtime role). A full `up → down → up`
  scratch-database harness is plan-08.
- Convention and procedure: [`docs/migrations.md`](../docs/migrations.md).

---

## 5. Flows

### 5.1 Authentication and session

- **Login** — email + password → argon2id verify → create `Session` row → set
  httpOnly, `SameSite=Lax`, `Secure` (prod) cookie. Every request resolves the
  session row; no row → 401 (API) or redirect to `/login` (pages).
- **Guest invite** — an internal user creates a `GuestInvite` bound to a
  `Client`. Link: `/portal/invite/<token>`. The guest sets a password; a `User`
  with `kind = GUEST` and that `clientId` is created; the invite is marked
  redeemed. Expired
  or already-redeemed tokens are dead.
- **Logout / revoke** — delete the `Session` row. The CTO can list and kill any
  session.

### 5.2 The client demand journey (the E2E spine)

Every arrow writes an `AuditEvent` and fires the relevant notifications.

```
guest submits Demand
  → BUSINESS_APPROVER scores value, TECHNICAL_APPROVER scores effort   (TRIAGING)
  → worth decision: PURSUE                                             (WORTH_ASSESSED)
  → convert to Change  (Change.originatingDemandId set)               (CONVERTED / Change.DRAFT)
  → RFC + risk / impact + rollback plan written                      (Change.ASSESSING → APPROVAL)
  → ApprovalRequest:
        step 1  TECHNICAL_APPROVER   (always)
        step 2  BUSINESS_APPROVER    (only if riskLevel = HIGH)
  → approve — or single-approver override + typed justification       (→ audit)
  → schedule implementation window                                   (SCHEDULED)
  → implement                                                        (IMPLEMENTING)
  → post-implementation review: valueRealized + lessons              (PIR)
  → close                                                            (CLOSED)
  → guest portal shows the linked demand as "Delivered"
```

### 5.3 Incident flow

`report (guest or internal) → categorise impact × urgency → derived priority +
dueAt → assign → in_progress → resolved (resolution text) → closed`. The
`overdue` flag surfaces on dashboards and the guest portal. A guest tracks their
own client's incidents, can comment, and sees SLA state.

### 5.4 Notification fan-out

Domain event → write `Notification` rows (in-app bell) + `EmailOutbox` rows →
the advisory-locked interval worker renders the template, sends via nodemailer,
and marks each row `sent`, or retries with backoff.

---

## 6. Frontend

### 6.1 Design-system port

`prototypes/flightdeck.html` is the source of truth for visual language.

- Extract the `:root` token blocks (light + dark) into `src/styles/tokens.css`
  unchanged. Fonts (Archivo display, IBM Plex Sans body, IBM Plex Mono
  labels/metadata) are **self-hosted** — no external CDN from the container.
- Port to React + CSS Modules: the app shell (rail, sticky topbar, view), the
  drawer + scrim, KPI tiles, panels, the data table with lifecycle pips,
  pills / chips / priority tags, the activity feed, the **lifecycle stepper with
  exit-gate checklists**, and toasts.
- Replace bespoke focus-trap / dialog / menu / tabs behaviour with Radix
  unstyled primitives, styled through the same tokens.
- **Drop** Flightdeck's Projects, Boards, and Live Status views — not in v1 or
  v2.

### 6.2 Internal app (CEO / CTO)

| Nav | Content |
| --- | --- |
| Overview | My queue · approvals waiting on me · overdue items · demand pipeline funnel · recent activity feed |
| Demands | Register table → drawer: problem, worth assessment (CEO value / CTO effort panels), decision, convert-to-change action |
| Incidents | List with severity rail → drawer: impact / urgency, timeline, assignee, linked change, comments |
| Changes | Register with lifecycle pips → drawer: RFC, risk, lifecycle stepper with exit gates, rollback plan, approval panel, PIR |
| Approvals | Everything routed to me; approve / reject with reason; override control with justification field |
| Audit | Filterable table (actor, subject, action, date range); CSV export |

The topbar shows the active hats. The drawer is the ported Flightdeck stepper
wired to real state and gates.

### 6.3 Guest portal (`/portal`)

Separate minimal layout, same tokens, no rail, no ITSM jargon.

- **My requests** — cards: title, plain-language status (Received / In review /
  Approved / In progress / Delivered / Declined), SLA state.
- **My incidents** — cards: Reported / Investigating / Resolved / Closed.
- **Submit** — one form for a demand (what + why), one for an incident against
  delivered software.
- **Detail** — a client-safe status timeline, client-visible comments, add a
  comment. No owner names beyond "Keel team", no internal notes, no CMDB, no
  calendar.

Both UIs call the same typed API. Guest scoping is enforced server-side
regardless of which UI calls.

---

## 7. Build order and parallelization

### Phase 0 — foundation (serial, single owner, no parallelism)

1. Prisma schema baseline + migration tooling + the restricted-grant SQL
   migration.
2. Auth.js database-session setup (with the §3.6 mitigation) + session
   middleware. Record the Auth.js-vs-contingency decision in
   `00-foundation.md`.
3. `authorize()` policy layer + `scopeToClient()` helper.
4. `writeAudit()` + the append-only enforcement test.
5. Notification plumbing (`Notification` + `EmailOutbox` + worker +
   nodemailer / Mailpit).
6. Shared `Comment` module (`addComment` / `listComments` + the
   `visibleToClient` rule).
7. Design-system port (`tokens.css` + shell + drawer + stepper + tiles / table /
   pill components).

**Interface contracts frozen before Phase 1** — see §8. Any change after
freezing requires a note to all Phase 1 owners.

### Phase 1 — modules (parallel, strict file ownership)

| Owner | Scope | Files |
| --- | --- | --- |
| A | Demand Management | `server/modules/demand/**`, `app/(internal)/demands/**`, demand API routes, demand schemas |
| B | Incident Management | `server/modules/incident/**`, `app/(internal)/incidents/**`, incident API routes, incident schemas |
| C | Change + Approvals (coupled — one owner) | `server/modules/change/**`, `server/modules/approvals/**`, `app/(internal)/changes/**`, `app/(internal)/approvals/**`, their API routes and schemas |
| D | Dashboards + Guest portal | `app/(internal)/overview/**`, `app/portal/**`, dashboard aggregation queries (read-only across modules) |

Owner D consumes other modules' published read APIs and writes nothing in them.
Cross-module writes are deferred to Phase 2 wiring.

### Phase 2 — integration (serial)

- Audit UI + CSV export.
- Notification trigger wiring across every module.
- Seed script covering every state.
- Playwright E2E (the demand journey, guest isolation, the override path, the
  incident lifecycle).
- Helm chart + CI + `kind` smoke.

---

## 8. Interface contracts (frozen before Phase 1)

> **Superseded by [`/CONTRACTS.md`](../CONTRACTS.md)** — that file is the
> authoritative, code-extracted freeze (verbatim from the shipped modules). This
> section is kept for design narrative only and may lag the real signatures.

```ts
// src/server/policy/actor.ts
export type Actor = {
  id: string;
  kind: "INTERNAL" | "GUEST";
  hats: Hat[];                       // [] for guests
  clientId: string | null;          // non-null iff kind === "GUEST"
};
export const isInternal = (a: Actor) => a.kind === "INTERNAL";
export const hasHat = (a: Actor, h: Hat) => a.hats.includes(h);

export type Subject =
  | { type: "none" }
  | { type: "audit" }
  | { type: "demand";   id?: string; submittedById?: string; clientId?: string | null; status?: DemandStatus }
  | { type: "incident"; id?: string; reportedById?: string; clientId?: string | null; status?: IncidentStatus }
  | { type: "change";   id?: string; ownerId?: string; status?: ChangeStatus; riskLevel?: Level }
  | { type: "approvalStep"; id?: string; requiredHat?: Hat; requestCreatedById?: string };

/** Throws ForbiddenError when not permitted (NotFoundError for a guest's cross-client miss). Deny by default. */
export function authorize(actor: Actor, action: string, subject: Subject): void;

/** Prisma `where` fragment to spread into guest reads; {} for internal actors. */
export function scopeToClient(actor: Actor): { clientId: string } | Record<string, never>;
```

```ts
// src/server/audit/write.ts
export type AuditInput = {
  actorId: string | null;
  action: string;            // "demand.create", "change.approve.technical", ...
  subjectType: string;
  subjectId: string;
  payload?: Record<string, unknown>;
};
export function writeAudit(tx: PrismaTransaction, input: AuditInput): Promise<void>;
```

```ts
// src/server/modules/notify/emit.ts
export type NotificationSpec = {
  recipients:
    | { userIds: string[] }
    | { hat: Hat }                       // all active internal users holding it
    | { audience: "ALL_INTERNAL" };      // every active internal user
  kind: NotificationKind;   // ASSIGNED | APPROVAL_NEEDED | STATUS_CHANGED | COMMENTED | OVERDUE
  subjectType: string;
  subjectId: string;
  summary: string;          // guest-safe wording whenever a guest may receive it
  email?: { template: string; payload: Record<string, unknown> };
};
export function emitNotification(tx: PrismaTransaction, spec: NotificationSpec): Promise<void>;
```

- `src/lib/api/` — a typed `fetch` wrapper. **Built:
  [`src/lib/api/client.ts`](../src/lib/api/client.ts)** — `apiFetch<T>(path,
  { method, body, schema, signal })` + `ApiError`. Every endpoint has a Zod
  request schema in `src/lib/api/schemas/`, and a response schema where a client
  needs the response shape; `apiFetch` infers its result type from the response
  schema passed to it. No code generation. Convention:
  [`src/lib/api/schemas/README.md`](../src/lib/api/schemas/README.md).
- The ported drawer and stepper components expose typed props documented in
  `00-foundation.md`.
- `PrismaTransaction` is `Prisma.TransactionClient`.

---

## 9. Testing strategy

- **TDD** RED / GREEN / REFACTOR on every module. No implementation code before
  a failing test.
- **Vitest** — unit + integration against a real PostgreSQL (a compose service
  in CI; a disposable schema per test file). Enforced coverage thresholds on:
  auth, RBAC + guest scoping, the approvals engine (including the override
  path), the audit log (append-only + completeness), and the demand→change
  conversion path.
- **Playwright** — the full client demand journey; guest isolation (client A
  cannot see client B's item, in the UI and via a direct API call); the
  approval override path with its justification landing in the audit log; the
  incident lifecycle with the overdue flag.
- **CI**, merge blocked on any failure:
  `lint → typecheck → unit+integration → build → e2e → helm lint → kind (install
  chart + migration job + /api/readyz + API smoke)`.
  `check:migrations` runs in the gate (folder-name convention + record-of-fact
  tables verified append-only); a full `up → down → up` scratch-database harness
  is plan-08. See §4.3 and [`docs/migrations.md`](../docs/migrations.md).

---

## 10. Deployment

- **Local** — `docker compose up` starts app + postgres + mailpit. `pnpm seed`
  loads the CEO, the CTO, two client organisations, and demands / incidents /
  changes in every state.
- **Container** — multi-stage Dockerfile (deps → build → runner), Next
  standalone output, non-root user, no secrets baked in.
- **Helm chart** (`helm/keel`, cluster-agnostic):
  - Deployment, Service, Ingress (host and `className` are values —
    placeholders in the staging / prod files).
  - ConfigMap for non-secret config; **Secret references only**
    (`existingSecret: keel-secrets`) — the chart never contains secret values.
  - Migration Job as a `pre-install` / `pre-upgrade` hook, run as the migration
    DB role.
  - `/api/healthz` (liveness), `/api/readyz` (DB reachable + migrations
    applied), `/metrics` (process + a few counters).
  - `values-staging.yaml` + `values-prod.yaml` — replica count, resources,
    ingress host, log level. HPA present, disabled by default.
- **Not in v1** — ArgoCD / Flux, metrics dashboards, real cluster targeting,
  TLS / cert-manager wiring (ingress annotations are placeholders).

---

## 11. Seed users

- **CTO user** (you) — `kind = INTERNAL`, hats `DEVELOPER`, `REVIEWER`,
  `TECHNICAL_APPROVER`. CAB chair; technical approval on every change; security
  sign-off; session administration.
- **CEO user** (partner) — `kind = INTERNAL`, hats `DEVELOPER`, `REVIEWER`,
  `BUSINESS_APPROVER`. Demand value scoring and worth decision; budget sign-off;
  release go/no-go; business approval on high-risk changes.
- Optionally a third internal user holding all four hats, for demoing the
  single-approver override cleanly.

Seed logins use placeholder names and `@keel.local` addresses documented in the
README; edit after first run. Two demo client organisations each get one guest
login (`kind = GUEST`, no hats).

---

## 12. Glossary

| Term | Meaning in Keel |
| --- | --- |
| Demand | A request for software or a feature, from a client or an internal user. The primary client-facing intake. |
| Worth assessment | The triage gate: `BUSINESS_APPROVER` business value + `TECHNICAL_APPROVER` effort / feasibility + cost of delay → `PURSUE` / `PARK` / `DROP`. |
| Change (RFC) | A proposed piece of work whose worth is already validated; carries risk, rollback plan, implementation window, and a post-implementation review. |
| CAB | Change Advisory Board. Here: a `TECHNICAL_APPROVER` step always, plus a `BUSINESS_APPROVER` step for high-risk changes. |
| Hat | A capability an internal user holds: `DEVELOPER`, `REVIEWER`, `BUSINESS_APPROVER`, `TECHNICAL_APPROVER`. One person can hold all four. |
| PIR | Post-implementation review — did the change deliver the expected value? |
| Single-approver override | The 2-person escape hatch: one person completes an approval step they would normally be barred from, with a typed justification written to the audit log. |
| Guest | An external client user, scoped to one client organisation, who never sees another client or any internal surface. |
| Overdue | `now > dueAt` and the item is not resolved or closed. The whole of v1's SLA. |
