# Spec 00 — Foundation

Auth and session, RBAC / policy layer, guest scoping, audit log, notification
plumbing, the design-system port, and the app shell. Everything in Phase 0.
Serial, single owner. Nothing in Phase 1 starts until the interface contracts
here are frozen.

Parent: [`../DESIGN.md`](../DESIGN.md).

---

## 1. Objectives

1. A logged-in internal user and a logged-in guest, each backed by a database
   session row.
2. `authorize(actor, action, subject)` — deny by default, one pure function per
   action.
3. `scopeToClient(actor)` — the guest row-scoping fragment.
4. `writeAudit(tx, input)` — the single append-only audit writer, with DB-level
   enforcement.
5. `emitNotification(tx, spec)` + the outbox worker.
6. The shared `Comment` module (create / list, `visibleToClient` rule).
7. `tokens.css` and the ported Flightdeck components the modules build on.

---

## 2. Data owned

`User`, `Session`, `Account`, `Client`, `GuestInvite`, `AuditEvent`,
`Notification`, `EmailOutbox`, `Comment`. Field lists in
[`data-model.md`](data-model.md).

The baseline Prisma schema (all tables for all modules) is created here in one
migration so Phase 1 owners never edit `schema.prisma` concurrently. Phase 1
owners add only data — not schema.

### 2.1 Restricted-grant migration

A raw SQL migration after the baseline:

```sql
-- runtime role: application connections
REVOKE UPDATE, DELETE ON audit_event FROM keel_app;
GRANT INSERT, SELECT ON audit_event TO keel_app;
-- migration role keeps full DDL + DML; used only by the migration Job / CLI
```

The compose file and Helm chart wire `DATABASE_URL` (runtime role `keel_app`)
and `MIGRATE_DATABASE_URL` (migration role) separately.

---

## 3. Auth and session

### 3.1 Chosen path

Auth.js v5 (`next-auth@5`) + `@auth/prisma-adapter`, `session.strategy =
"database"`, Credentials provider for email + password.

Mitigation for the credentials-does-not-persist-a-DB-session gap
(`DESIGN.md` §3.6):

- The Credentials `authorize` callback verifies email + `argon2id` hash and
  returns `{ id }` only.
- A custom route `POST /api/auth/callback/credentials` wrapper (or a
  `signIn` event handler) calls `adapter.createSession({ sessionToken,
  userId, expires })` and sets the `authjs.session-token` cookie
  (httpOnly, `SameSite=Lax`, `Secure` in prod, 30-day expiry, sliding).
- `middleware.ts` resolves auth **only** via `adapter.getSessionAndUser(token)`.
  No JWT branch exists in the code.

### 3.2 Contingency (decide by end of Phase 0 step 2)

If the above is fragile, replace with a purpose-built module:
`createSession(userId)`, `getSession(token)`, `destroySession(token)`,
`Session` table with a hashed token. Same cookie semantics. `authorize()` and
every downstream consumer are unaffected — they take an `Actor`, not an Auth.js
object. **Record the decision and the reason at the top of this spec before
Phase 1.**

### 3.3 Flows

- **Login** `POST /api/auth/login` — `{ email, password }` → session + cookie,
  or 401. Rate-limited (in-memory token bucket per IP, tune in code).
- **Logout** `POST /api/auth/logout` — delete the session row, clear the
  cookie.
- **Session list / revoke** (`TECHNICAL_APPROVER`) `GET /api/sessions`,
  `DELETE /api/sessions/:id`.
- **Guest invite create** (any internal user) `POST /api/guest-invites` —
  `{ clientId, email }` → `{ url }`. Token is random 32 bytes, stored hashed,
  `expiresAt = now + 7d`.
- **Guest invite redeem** `GET /portal/invite/:token` (page) +
  `POST /api/guest-invites/:token/redeem` — `{ name, password }` → creates the
  `User` (`kind = GUEST`, `clientId` from the invite, no hats), marks the
  invite redeemed, logs the user in. Expired / redeemed → 410.

### 3.4 Audit events

`auth.login`, `auth.login_failed` (actor = the attempted email, not a user id),
`auth.logout`, `session.revoked`, `guest_invite.created`,
`guest_invite.redeemed`.

---

## 4. Policy layer

`src/server/policy/` — `authorize.ts`, `actions.ts` (the action catalogue),
`scope.ts`, one `*.policy.ts` per subject type.

### 4.1 Contract

See `DESIGN.md` §8. `authorize` throws `ForbiddenError` (mapped to 403 by the
API error handler; guest "not yours" cases throw `NotFoundError` → 404).

### 4.2 Action catalogue (v1)

`INTERNAL` = any internal user (has ≥1 hat). Hat names abbreviated: `DEV`,
`REV`, `BIZ` (`BUSINESS_APPROVER`), `TECH` (`TECHNICAL_APPROVER`).

```
auth.*                     (handled in the auth module, not policy)
demand.create              GUEST | INTERNAL
demand.view                owner-guest (same client) | INTERNAL
demand.score.value         BIZ
demand.score.effort        TECH
demand.decide              BIZ | TECH   (worth decision; SoD note below)
demand.convert             BIZ | TECH
demand.reject              BIZ | TECH
incident.create            GUEST | INTERNAL
incident.view              owner-guest (same client) | INTERNAL
incident.categorize        INTERNAL (DEV)
incident.assign            INTERNAL (DEV)
incident.transition        INTERNAL (DEV)
change.create              INTERNAL (DEV)
change.view                INTERNAL         (never GUEST)
change.edit                change owner | INTERNAL (DEV)
change.review              REV
change.submit_for_approval change owner (must have rollbackPlan)
change.approve.technical   TECH,  not the change owner  (SoD -> override)
change.approve.business    BIZ,   not the change owner  (SoD -> override), only when riskLevel = HIGH
change.schedule            INTERNAL (DEV)
change.transition          INTERNAL (DEV)
change.pir                 BIZ | TECH
comment.create             any actor on a subject they can view
comment.view.internal      INTERNAL
audit.view                 INTERNAL
audit.export               INTERNAL
notification.view.own      any actor
```

**SoD.** `demand.decide` and both `change.approve.*` actions check
`actor.id !== subject.submittedById` (demand) / `subject.ownerId` (change). When
equal, `authorize` throws `SegregationError` carrying a machine-readable
`overrideAction`; the route offers the override path (spec 04 for changes,
spec 01 §4 inline for demands).

### 4.3 Tests (RED first)

- Every action × { guest, internal with each single hat, internal with all
  hats } → allow / deny table, exhaustive.
- Guest cross-client: `authorize` + `scopeToClient` both deny.
- An internal user holding all four hats passes every internal check; one
  holding only `DEV` fails `demand.score.value`, `demand.decide`, and both
  `change.approve.*`.
- SoD: the change owner hitting their own approval throws `SegregationError`
  with the right `overrideAction`.

---

## 5. Guest scoping

`scopeToClient(actor)` returns `{ clientId: actor.clientId }` for guests,
`{}` for internal. Every guest-facing list/read query spreads it into `where`.
Guest single-item reads that miss → `NotFoundError`.

Serializers: `serializeFor(actor, entity)` per module, with an explicit
`guest` branch. A shared test helper asserts a guest-serialized object contains
no key from a per-module `INTERNAL_ONLY_KEYS` set.

---

## 6. Audit log

`writeAudit(tx, input)` inserts one row. Always called inside the same
transaction as the domain write. Never called from route handlers directly —
only from module services.

Enforcement test: open a transaction as `keel_app`, insert an event, attempt
`UPDATE` and `DELETE` → both rejected by the grant. Attempt an event insert with
a missing `requestId` → rejected by a `NOT NULL` + app-level Zod guard.

`requestId` is generated in `middleware.ts` (`crypto.randomUUID()`), carried on
a request-scoped context (`AsyncLocalStorage`), and read by `writeAudit`.

---

## 7. Notification plumbing

- `emitNotification(tx, spec)` — resolves `recipients` to user ids, inserts
  `Notification` rows, and (if `spec.email`) `EmailOutbox` rows. All within the
  caller's transaction.
- **Worker** — `src/server/modules/notify/worker.ts`. On an interval
  (`NOTIFY_POLL_MS`, default 5000): `pg_try_advisory_lock` → select `pending`
  outbox rows with `nextAttemptAt <= now()` (limit N, `FOR UPDATE SKIP LOCKED`)
  → render template → send via nodemailer → mark `sent`, or increment
  `attempts` + set `lastError` + `nextAttemptAt = now() + backoff(attempts)` →
  release lock. Give up at `attempts >= 6`, status `failed`. Full detail in
  `05-notifications.md` §6.
- Started from `instrumentation.ts` (Next `register()`), guarded to one start
  per process.
- Templates: plain functions `(payload) => { subject, text, html }` in
  `notify/templates/`. HTML is a minimal shared layout.

Tests: `emitNotification` writes the right rows; worker sends a `pending` row
and marks it `sent`; worker retries then fails at 6; advisory lock prevents two
workers sending the same row (simulate two worker ticks).

---

## 8. Comments (shared module)

`src/server/modules/comment/` — used by demand, incident, and change drawers and
by the guest portal.

- `addComment(tx, { actor, subjectType, subjectId, body, visibleToClient })` and
  `listComments(actor, subjectType, subjectId)`.
- `subjectType` ∈ `demand | incident | change`. The caller has already run
  `authorize(actor, "comment.create", subject)` (the actor can see the subject).
- **`visibleToClient` rule**: a `guest` author's comment is always forced
  `visibleToClient = true` (a guest cannot write an internal note). An internal
  author chooses; default `false`. `listComments` for a guest returns only
  `visibleToClient = true` rows; for an internal actor, all rows.
- On a change (guest-invisible subject) a guest `listComments` call throws
  `NotFoundError`.
- Every add emits `comment.created` audit + a `comment` notification to the
  other party (spec 05 §4).
- Internal author identity is replaced with "Keel team" by the guest serializer.

Tests: guest comment forced client-visible; guest never sees an internal note;
internal author masked for guests; comment on a change denied to a guest;
audit + notification emitted.

---

## 9. Design-system port

### 9.1 Tokens

`src/styles/tokens.css` — copy the `:root`, `@media (prefers-color-scheme:dark)`,
and `:root[data-theme=...]` blocks from `prototypes/flightdeck.html` verbatim.
A `ThemeProvider` sets `data-theme` from a cookie; default follows the system.

Fonts self-hosted under `src/app/fonts/` via `next/font/local`: Archivo, IBM
Plex Sans, IBM Plex Mono. No `fonts.googleapis.com` at runtime.

### 9.2 Components ported to `src/components/` (CSS Modules)

| Component | Source in prototype | Notes |
| --- | --- | --- |
| `AppShell` | `.app`, `.rail`, `.topbar`, `.view` | rail nav items are props; responsive bottom-bar behaviour kept |
| `Drawer` | `.scrim`, `.drawer` | Radix `Dialog` under the hood, styled with the prototype's CSS |
| `Tile` | `.tiles`, `.tile` | KPI tile |
| `Panel` | `.panel` | header + body |
| `DataTable` | `.table`, `.thead`, `.trow` | column defs as props; `LifecyclePips` cell |
| `Pill`, `PriorityTag`, `RiskLabel` | `.pill`, `.pri`, `.risk` | |
| `ActivityFeed` | `.feed` | |
| `LifecycleStepper` | `.stepper`, `.step`, `.gate` | **the centrepiece** — stages + exit-gate checklist, `Advance` disabled until every gate item checked; `onAdvance(stage)` prop |
| `Toasts` | `.toasts` | `toast(msg)` imperative API + provider |
| `Timeline` | `.tl` | audit / activity timeline in drawers |

### 9.3 Stepper contract

```ts
type Stage = { key: string; label: string; purpose: string;
  gate: { key: string; label: string; hint?: string; done: boolean }[] };
type LifecycleStepperProps = {
  stages: Stage[];
  currentStageKey: string;
  canAdvance: boolean;                       // server-computed
  onToggleGate?: (stageKey: string, gateKey: string, done: boolean) => void;
  onAdvance?: (fromStageKey: string) => void;
  readOnly?: boolean;                        // guests, closed items
};
```

### 9.4 Tests

Component tests (Vitest + Testing Library, jsdom): shell renders nav and marks
the current item; drawer traps focus and closes on Escape / scrim; stepper
disables `Advance` until gates complete and calls `onAdvance` with the right
key; theme toggle flips `data-theme`.

---

## 10. Definition of done

- Login → DB session → protected route → logout, for internal and guest, green
  end to end.
- `authorize` allow/deny table exhaustive and green.
- Guest cannot read another client's row (service test + a raw query test).
- Guest comment forced client-visible; guest never sees an internal note.
- Audit `UPDATE` / `DELETE` rejected at the DB.
- Outbox worker sends via Mailpit locally.
- All §9.2 components rendered in a `/dev/components` gallery page (dev-only).
- Interface contracts in `DESIGN.md` §8 match the code. Frozen.
