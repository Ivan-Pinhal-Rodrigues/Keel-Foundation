# Keel — Phase 0 Interface Contracts

**Frozen at the end of Phase 0.** These are the interfaces Phase 1 builds against.
Changes require a note to all Phase 1 owners (A: demand · B: incident ·
C: change + approvals · D: dashboards + portal).

Extracted verbatim from the shipped code. Every signature below is unchanged from
the Phase 0 baseline commit `540e204`; the Task 32 freeze commit (`40c0539`) and
its review-round-2 follow-up add this file, the `/dev` gallery, and the two
`logger.info` startup lines noted in §3 — no quoted signature changed. Where this
document and the code disagree, the code wins — open a PR to fix this file.

**How to read the signatures below.** Exported `type` / `interface` / `class`
declarations are copied verbatim from the source. Function signatures are shown
in declaration form: the body is elided and a leading `async` is dropped — the
`Promise<…>` return type is what a caller sees. `client: PrismaTransaction =
prisma` style trailing parameters keep their default in the quote because the
default is part of the callable contract (you may omit the argument).

## Phase 1 amendments

Interfaces changed after the Phase 0 freeze. Each was reviewed and agreed with all Phase 1 owners.

- **plan-1a Task 1** — `src/server/auth/current.ts` added. Server components and layouts resolve the actor with `getCurrentActor()` / `whoami()` (read the cookie via `next/headers`). `getActor()` / `getActorOrNull()` (§6) remain **API-route-only** — they read the request context that only `withRequest` populates and throw / return null everywhere else. **Never call an audit-writing service from a server component** — `writeAudit` needs the request context and will throw `"no request context"`.
- **plan-1a Task 2** — `scopeToClient` now fails closed: a guest with a null `clientId` (a data bug the new `user_guest_has_client` CHECK constraint prevents) gets an impossible-match `{ clientId: … }`, never `{}`. Spreading it into a `where` matches zero rows. Consumed by plan-01 Task 2's `listDemands`, plan-02, plan-04.
- **plan-1a Task 3** — `serializePick` (allowlist) added to `src/server/policy/serialize.ts`; `serializeFor` is kept but marked internal-shaping-only (denylist — a new column leaks to guests by omission). `plan-01`'s `serializeDemand` and all Phase 1 guest serializers use `serializePick`, not `serializeFor`.
- **plan-1a Task 4** — `addComment` / `listComments` (`src/server/modules/comment/index.ts`) take one `CommentSubject` (`{ type, id, clientId }`) instead of a bare `(subjectType, subjectId)`, and call `requireOwnClientOr404(actor, subject.clientId)` internally — a portal comment route that forgets the ownership check can no longer leak another client's `visibleToClient` thread. The action check (`authorize(actor, "comment.create", …)` for a write, the subject's own view check for a read) stays with the caller. `CommentSubjectType` is removed (superseded by `CommentSubject`). Consumed by plan-01 Task 6 (demand comments route), plan-02 (incident drawer), plan-03 (change drawer).
- **plan-1a Task 5** — record-of-fact tables (`AuditEvent`, `ApprovalDecision`, `PostImplementationReview`) are append-only for `keel_app` at the DB privilege level (§2). `20260903125809_audit_default_privileges` revokes `UPDATE, DELETE` on `ApprovalDecision` and `PostImplementationReview` — both predate `20260901200800_audit_grants` and were granted full DML by its `GRANT … ON ALL TABLES IN SCHEMA`. New gate check `scripts/check-migrations.mjs` (in `pnpm test` and `pnpm check:migrations`) fails if any record-of-fact table is mutable by the runtime role, or if a migration folder breaks the `<14-digit UTC ts>_<snake>` name / has a colliding timestamp. Convention doc: [`docs/migrations.md`](docs/migrations.md). Consumed by plan-03 (`ApprovalDecision`, PIR writes), plan-08 (up/down/up harness).
- **plan-1a Task 7** — `src/lib/api/client.ts` added (§7): `apiFetch<T>(path, { method, body, schema, signal })` + `ApiError` / `ApiErrorBody`, the browser-side typed `fetch` wrapper `DESIGN.md` §8 promised. Non-2xx → `throw new ApiError(status, body)`; a 204 / empty body → `undefined`; a `schema` parses and types the 2xx body, a mismatch throwing `ZodError` not `ApiError`; a transport failure rejects untouched. Response-schema convention: `src/lib/api/schemas/README.md` — request schema always (`<verb><Noun>Body`), response schema (`<noun>Response`) where a client needs the shape; Phase 0's schema files are not retrofitted. Consumed by every Phase 1 client component — plan-01 (demand UI), plan-02 (incident UI), plan-03 (change UI), plan-04 (dashboards + portal).
- **plan-1a Task 8** — `LifecycleStepperProps` gains `blockedReason?: string` (rendered under a disabled Advance once every current-stage gate is checked — the non-gate reason: approval pending, no window; while gates are incomplete the gate-count hint still wins) and `Stage` gains `state?: "done" | "current" | "upcoming" | "blocked" | "reverted"`, an override that wins over the state derived from `currentStageKey` + array order. A stage with an explicit `state` is inert (no interactive gates, no Advance button); `"blocked"` / `"reverted"` add amber (`--warn`) / muted-red (`--crit`) node + label tints. Additive — an unset `state` and unset `blockedReason` are exactly the Phase 0 behaviour. Consumed by plan-03 (the change drawer — a rolled-back change renders every stage `reverted`; an approval-pending change shows `blockedReason` under a stuck Advance).
- **plan-1a Task 9** — `DataTableProps.onRowClick` is now **optional** and `getRowId` moved above it in the type. A read-only display table (dashboards, portal) omits `onRowClick` and renders inert — no activator, no `<tr>` handler, no affordance. When set, row activation is a visually-hidden `<button>` in the first cell (keyboard path) plus a guarded `onClick` on the `<tr>` (mouse path); `role="row"` stays on the `<tr>`, with no `tabIndex` / `onKeyDown` — Phase 0's `<tr role="button">` around `<td>` gridcells was invalid ARIA. The `<tr>` guard early-returns when `event.target.closest("a,button,input,select,textarea,label")` is truthy, so an interactive element inside a `cell` (an actions column) fires only its own handler: **no `stopPropagation` needed**, superseding the Phase 0 consumer note. Additive for existing callers that already pass `onRowClick`. Consumed by plan-01 Task 5 (demand register), plan-02 (incident register), plan-04 (dashboards + portal).
- **plan-1a Task 10** — `src/server/db/errors.ts` added (§7): `isUniqueViolation(e, target?)` / `isNotFound(e)`, typed `instanceof Prisma.PrismaClientKnownRequestError` P2002 / P2025 checks. `src/server/auth/invites.ts` drops its local duck-typed P2002 check for the shared helper (identical on the real transaction-scoped error, stricter elsewhere). `Client.name` is now `@unique` (migration `client_name_unique`) — seed and any Client insert must expect a name collision. Idempotent `prisma/seed.ts` (`pnpm seed`): `admin@keel.local` / `Keel-admin-2026` (4 internal hats) + Client "Northwind Traders". Consumed by plan-03 (convert idempotency), plan-01 (redeem race).
- **plan-1a Task 13** — `src/server/audit/labels.ts` added (§2): the `AUDIT_ACTION_LABELS` registry maps audit action strings to human-readable phrases for timelines and activity feeds. Every audit-writing module appends its actions to the registry; spec-06's dashboard activity test iterates `AUDIT_ACTION_LABELS` keys to ensure no action lacks a label. `auditActionLabel(action)` returns the registered phrase or a humanized fallback (`"demand.value_scored"` → `"Demand value scored"`); `guestAuditActionLabel(action)` returns the phrase for guest-visible actions only (internal-only actions like `session.revoked` → `null`). Consumed by plan-01 (demand timeline), plan-04 (dashboards + portal activity feed).
- **plan-02** — `src/server/modules/incident/` ships the incident lifecycle. `serializeIncident(actor, row, { now, linkedChanges })` (`serialize.ts`) — allowlist guest view (`INCIDENT_GUEST_KEYS`), `overdue` always derived fresh (never the stored column), guest `status` / `slaLine` / `fix`. `priorityFor` / `dueAtFrom` / `isOverdue` (`priority.ts`, pure — safe to import from a client component, type-only Prisma dep). `INCIDENT_TRANSITIONS` / `assertTransition` / `REOPEN_WINDOW_MS` (`state.ts`). Service: `createIncident` (actor-selected input union — internal `{ impact, urgency }` vs guest `{ affectingLevel }` folded into `description`, `impact`/`urgency`/`priority` server-forced to `MEDIUM`/`MEDIUM`/`P3`), `listIncidents`, `getIncidentForActor` (+ `activity`, + `linkedChanges` for internal only), `listLinkedChanges`, `incidentClientId`, `categorizeIncident` (priority always recomputed; `dueAt` recomputed only while `NEW`/`ASSIGNED`; a reason is required once work has started, written to the audit payload + an internal comment), `assignIncident` (assignee must be an active internal user; `NEW` → `ASSIGNED`), `transitionIncident`, `reopenIncident` (`CLOSED` only within `REOPEN_WINDOW_MS` = 14 days). `sweepOverdueIncidents` + `startOverdueSweeper` (`sweep.ts`, wired into `bootstrap.ts`, `OVERDUE_POLL_MS` default 60000) — emits `incident.overdue` + one `OVERDUE` notification per internal user, once per incident (`overdueNotifiedAt`). New endpoint `GET /api/users?kind=INTERNAL` → `{ users: [{ id, displayName }] }`, active internal users, `requireInternal`. `incident_status` email template (guest-safe, `{ ref, status }`). `AUDIT_ACTION_LABELS` + `guestAuditActionLabel` gain the `incident.*` entries (guest sees create / transitioned / resolved / closed only). Consumed by plan-03 (`ChangeIncidentLink` writes + the "caused by" / "fixes" drawer wiring), plan-04 (incident dashboard tiles, portal shell).

---

## 1. Identity & policy

### `src/server/policy/actor.ts`

Who is making a request, and the hat set. Zero imports, zero I/O — safe to pull
in from anywhere (including `@/server/context`).

```ts
export type Hat =
  "DEVELOPER" | "REVIEWER" | "BUSINESS_APPROVER" | "TECHNICAL_APPROVER";

export type Actor = {
  id: string;
  kind: "INTERNAL" | "GUEST";
  hats: Hat[]; // [] for guests
  clientId: string | null; // non-null iff kind === "GUEST"
};

export const isInternal = (a: Actor) => a.kind === "INTERNAL";
export const hasHat = (a: Actor, h: Hat) => a.hats.includes(h);
```

### `src/server/policy/actions.ts`

The policy action catalogue — one string literal per authorised operation.
`authorize()` dispatches on the `Action` union; `ACTIONS` is the runtime array
the exhaustive matrix test iterates (compile-time guarded to list every union
member). `auth.*` is deliberately absent — authentication is not a policy action.

```ts
export type Action =
  | "demand.create"
  | "demand.view"
  | "demand.score.value"
  | "demand.score.effort"
  | "demand.decide"
  | "demand.convert"
  | "demand.reject"
  | "incident.create"
  | "incident.view"
  | "incident.categorize"
  | "incident.assign"
  | "incident.transition"
  | "change.create"
  | "change.view"
  | "change.edit"
  | "change.review"
  | "change.submit_for_approval"
  | "change.approve.technical"
  | "change.approve.business"
  | "change.schedule"
  | "change.transition"
  | "change.pir"
  | "comment.create"
  | "comment.view.internal"
  | "audit.view"
  | "audit.export"
  | "notification.view.own";

export const ACTIONS = [
  "demand.create",
  "demand.view",
  "demand.score.value",
  "demand.score.effort",
  "demand.decide",
  "demand.convert",
  "demand.reject",
  "incident.create",
  "incident.view",
  "incident.categorize",
  "incident.assign",
  "incident.transition",
  "change.create",
  "change.view",
  "change.edit",
  "change.review",
  "change.submit_for_approval",
  "change.approve.technical",
  "change.approve.business",
  "change.schedule",
  "change.transition",
  "change.pir",
  "comment.create",
  "comment.view.internal",
  "audit.view",
  "audit.export",
  "notification.view.own",
] as const satisfies readonly Action[];
```

### `src/server/policy/subjects/types.ts`

The `Subject` discriminated union. Every field past `type` is optional: a route
passes as much of the subject as it has loaded, and each rule reads only what it
needs. `$Enums` is a type-only import from the generated Prisma client (erased at
compile — does not cross the `@prisma/client` value boundary).

```ts
import type { $Enums } from "@prisma/client";
import type { Hat } from "@/server/policy/actor";

export type Subject =
  | { type: "none" }
  | { type: "audit" }
  | {
      type: "demand";
      id?: string;
      submittedById?: string;
      clientId?: string | null;
      status?: $Enums.DemandStatus;
    }
  | {
      type: "incident";
      id?: string;
      reportedById?: string;
      clientId?: string | null;
      status?: $Enums.IncidentStatus;
    }
  | {
      type: "change";
      id?: string;
      ownerId?: string;
      status?: $Enums.ChangeStatus;
      riskLevel?: $Enums.Level;
    }
  | {
      type: "approvalStep";
      id?: string;
      requiredHat?: Hat;
      requestCreatedById?: string;
    };
```

### `src/server/policy/authorize.ts`

The policy engine. Returns on allow, **throws on deny**. Deny by default: an
action with no rule falls through to `ForbiddenError`. `comment.create` defers to
the view rule for the subject's own type (demand / incident / change); a subject
with no view rule cannot be commented on.

```ts
// The dispatch table. `Record<Action, Rule>` is the compile-time
// exhaustiveness gate — a missing action fails `tsc`.
export const RULES: Record<Action, Rule>;

// Throws ForbiddenError when not permitted (NotFoundError for a guest's
// cross-client miss, SegregationError for a duties conflict). Deny by default.
export function authorize(actor: Actor, action: Action, subject: Subject): void;
```

`Rule` (from `src/server/policy/rule.ts`) is `(actor: Actor, subject: Subject) =>
void`.

### `src/server/policy/errors.ts`

The policy-layer domain errors. `mapError` (§7) is the one place they become HTTP.
Kept import-free — a leaf, so anything may depend on it. `UnauthenticatedError`
deliberately lives elsewhere (`@/server/auth/actor`).

```ts
/** The actor is known but not allowed to perform this action. → 403. */
export class ForbiddenError extends Error {}

/** The subject does not exist — or the actor may not be told that it does
 *  (guest "not yours" reads collapse to this). → 404. */
export class NotFoundError extends Error {}

/** The subject was valid once but is spent: an expired, already-redeemed, or
 *  unknown invite. → 410. */
export class GoneError extends Error {}

/** Separation of duties: the actor holds the right hat but may not apply it to
 *  this subject (approving a change they own, deciding a demand they raised).
 *  `overrideAction` is the machine-readable action the route offers instead.
 *  → 409. */
export class SegregationError extends Error {
  constructor(public overrideAction: string) {
    super("segregation of duties");
  }
}
```

### `src/server/policy/scope.ts`

Guest data-scoping helpers. `scopeToClient` is a Prisma `where` fragment to
spread into a guest read (`{}` for an internal actor). It **fails closed**: a
guest whose `clientId` is somehow `null` — a data bug the `user_guest_has_client`
CHECK constraint (migration `20260903005643_user_guest_client_check`) prevents —
gets an impossible-match `{ clientId: "…" }` that matches zero rows, never `{}`.
`assertVisibleToGuest` throws `NotFoundError` when a loaded row is not the
guest's own client's.

```ts
export function scopeToClient(
  actor: Actor,
): { clientId: string } | Record<string, never>;

export function assertVisibleToGuest(
  actor: Actor,
  row: { clientId: string | null } | null,
): void;
```

### `src/server/policy/serialize.ts`

Role-aware serialisation. **`serializePick` is an allowlist — use it for any
guest-visible output**: it builds a guest view from `guestKeys` only, so a
column added later defaults to hidden. `serializeFor` is a denylist kept for
**internal shaping only — do not use it for guest output**: it spreads the whole
row and deletes an enumerated list, so a new column leaks to a guest by
omission. Both return the row unchanged (`serializePick`: minus `internalOmit`)
for an internal actor. `assertNoInternalKeys` is the test-time guard that no
internal-only key survived.

```ts
export type SerializerConfig<T> = {
  internalOnlyKeys: readonly (keyof T)[];
  guestTransform?: (row: T) => Partial<T> & Record<string, unknown>;
};

/** Internal shaping only — do not use for guest output (a new column leaks by
 *  omission). Use `serializePick`. */
export function serializeFor<T extends Record<string, unknown>>(
  actor: Actor,
  row: T,
  cfg: SerializerConfig<T>,
): Record<string, unknown>;

/** Allowlist serializer for guest output. Internal reader: the row as-is, minus
 *  `internalOmit`. Guest: only `guestKeys`, then `guestTransform` merged over.
 *  Adding a column defaults to hidden. */
export function serializePick<T extends Record<string, unknown>>(
  actor: Actor,
  row: T,
  cfg: {
    guestKeys: readonly (keyof T)[];
    guestTransform?: (row: T) => Record<string, unknown>;
    internalOmit?: readonly (keyof T)[];
  },
): Record<string, unknown>;

export function assertNoInternalKeys(
  obj: Record<string, unknown>,
  keys: readonly string[],
): void;
```

---

## 2. Audit

### `src/server/audit/write.ts`

The single append-only audit writer. Runs on the caller's transaction so the
domain write and its audit row commit together.

```ts
export type AuditInput = {
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  payload?: Record<string, unknown>;
};

export function writeAudit(
  tx: PrismaTransaction,
  input: AuditInput,
): Promise<void>;
```

**Gotchas.**

- `actorId` is `string | null` — a failed login has no user to point at, so the
  attempted email is the `subjectId` and `actorId` stays `null`.
- `requestId` is **not** an `AuditInput` field. `writeAudit` reads it from async
  context via `getRequestId()` (§9), which **throws `"no request context"`** if
  the caller is not inside `runWithContext` / `withRequest`.

### `src/server/audit/labels.ts`

The audit action → phrasing map for timelines and activity feeds. Each module
that writes an audit action appends its entries to `AUDIT_ACTION_LABELS`. Phase 1
tasks (plan-01: `demand.create` / `demand.decided` / …; plan-02: incident;
plan-03: change + approval; plan-04: dashboard; plan-06: spec-06 dashboard
exports) each update this registry so `guestAuditActionLabel` can govern feed
visibility per actor kind.

```ts
export const AUDIT_ACTION_LABELS: Record<string, string>;
/** The phrase, or a humanised fallback (`"demand.value_scored" → "Demand value scored"`). */
export function auditActionLabel(action: string): string;
/** For a guest-facing feed: the subset + guest phrasing (internal-only actions → null). */
export function guestAuditActionLabel(action: string): string | null;
```

### Record-of-fact tables

`AuditEvent`, `ApprovalDecision`, and `PostImplementationReview` are permanent
records of a fact. The runtime role (`keel_app`) has **`SELECT` + `INSERT` only**
— `UPDATE` / `DELETE` are revoked at the database privilege level, so a service
bug cannot rewrite history. A migration that adds a new record-of-fact table
must `REVOKE UPDATE, DELETE … FROM keel_app` in the same migration and add the
table to `RECORD_OF_FACT` in `scripts/check-migrations.mjs` (run in the gate).
See [`docs/migrations.md`](docs/migrations.md).

---

## 3. Notifications

### `src/server/modules/notify/types.ts`

The `emitNotification` contract. Frozen so Phase 1 module owners can wire
notification calls without coordinating on recipient-resolution logic.

```ts
import type { $Enums } from "@prisma/client";

export type NotificationKind = $Enums.NotificationKind;

/**
 * Who a notification is for. `{ hat }` and `{ audience: "ALL_INTERNAL" }` resolve
 * to active internal users only; `{ userIds }` is taken as given (unknown ids are
 * silently skipped rather than crashing on a missing FK).
 */
export type Recipients =
  { userIds: string[] } | { hat: $Enums.Hat } | { audience: "ALL_INTERNAL" };

export type NotificationSpec = {
  recipients: Recipients;
  kind: NotificationKind;
  subjectType: string;
  subjectId: string;
  summary: string;
  /** The acting user, dropped from the resolved recipient list (you are not
   *  notified of your own action). */
  excludeActorId?: string;
  /** When set, one `EmailOutbox` row per recipient that has an address. */
  email?: { template: string; payload: Record<string, unknown> };
};
```

### `src/server/modules/notify/emit.ts`

The one way a domain write raises notifications. Recipient resolution, the
`Notification` inserts and the `EmailOutbox` inserts **all run on the caller's
`tx`** — a notification is never delivered for a change that was rolled back. No
`AuditEvent` is written (notifications derive from audited state, they are not
independent facts).

```ts
export function emitNotification(
  tx: PrismaTransaction,
  spec: NotificationSpec,
): Promise<void>;
```

### `src/server/modules/notify/worker.ts`

The email outbox worker. One tick = one `$transaction`: `pg_try_advisory_xact_lock`
so exactly one sender runs across replicas, claim the oldest due `PENDING` rows
(`FOR UPDATE SKIP LOCKED`, `NOTIFY_BATCH` default 20), render + send each, mark
`SENT` / back off / `FAILED` at 6 attempts. `runOutboxOnce` never throws.

```ts
/** Retry backoff: `min(2 ** attempts, 30)` minutes, in milliseconds. */
export function backoffMs(attempts: number): number;

export function runOutboxOnce(deps: {
  transport: Transport;
  now?: () => Date;
  // Defaults to the app singleton; tests pass the disposable-schema client.
  db?: PrismaClient;
}): Promise<{ sent: number; failed: number; deferred: number }>;

/** Start the polling loop — one per process, guarded on `globalThis`. Poll
 *  interval `NOTIFY_POLL_MS` (default 5000). Emits one `logger.info`
 *  ("outbox worker started") on the tick that actually starts it. */
export function startOutboxWorker(): void;
```

The `{ sent; failed; deferred }` return shape is a local type (`OutboxCounts`),
not exported.

As of the Task 32 fix commit, `startOutboxWorker()` and `bootstrap()`
(`src/server/bootstrap.ts`) each emit one `logger.info` startup line
(`@/server/log`) — "outbox worker started" and "keel bootstrap complete". No
signature changed.

### `src/server/modules/notify/transport.ts`

The mail transport seam. The worker depends only on the `Transport` interface;
tests inject a fake, production injects `nodemailerTransport()`. Nothing else in
`notify/` imports `nodemailer`.

```ts
export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface Transport {
  send(msg: OutgoingMail): Promise<void>;
}

/** The real transport: one SMTP connection from `SMTP_URL`. Constructed lazily
 *  by the worker — importing this file never opens a socket. Throws if
 *  `SMTP_URL` is unset. */
export function nodemailerTransport(): Transport;
```

### `src/server/modules/notify/templates/index.ts`

The email template registry. A template is a pure function
`payload -> { subject, text, html }`. Registered templates: `guest_invite`
(Phase 0) and `demand_decided` (plan-01 Task 4 — payload `{ ref, status }`,
sent to a guest submitter when their demand is decided or declined).

```ts
export type Rendered = { subject: string; text: string; html: string };
export type Template = (payload: Record<string, unknown>) => Rendered;

export const templates: Record<string, Template>;

/** Throws `unknown template: <name>` for an unregistered name. */
export function renderTemplate(
  name: string,
  payload: Record<string, unknown>,
): Rendered;
```

---

## 4. Comments

### `src/server/modules/comment/index.ts`

The shared comment module — used by the demand / incident / change drawers and
the guest portal. `subject.type` is stored capitalised in `Comment.subjectType`.
The caller still runs the **action** check — `authorize(actor, "comment.create",
subject)` for a write, the subject's own view check for a read — but the subject
now carries `clientId` and the module calls `requireOwnClientOr404` itself:
ownership is no longer solely the caller's responsibility.

```ts
export type CommentSubject =
  | { type: "Demand"; id: string; clientId: string | null }
  | { type: "Incident"; id: string; clientId: string | null }
  | { type: "Change"; id: string };

/**
 * Create a comment on `subject`, audit it, and optionally notify one user.
 * Returns the RAW, unserialized `Comment` row — a route handler MUST pass it
 * through `serializeComment(actor, …)` (or re-list via `listComments`) before it
 * reaches a response.
 */
export function addComment(
  tx: PrismaTransaction,
  input: {
    actor: Actor;
    subject: CommentSubject;
    body: string;
    /** Internal author's choice; default false. Ignored for guests. */
    visibleToClient?: boolean;
    notifyUserId?: string;
  },
): Promise<Comment>; // Prisma row type

export function listComments(
  actor: Actor,
  subject: CommentSubject,
  client: PrismaClient = prisma,
): Promise<SerializedComment[]>;
```

**Gotchas.**

- A **guest** author's comment is always forced `visibleToClient = true`
  (`input.visibleToClient` is ignored for a guest).
- A guest calling `addComment` **or** `listComments` with a `Change` subject
  gets a `NotFoundError` (a guest must never learn a Change exists) — even
  though the policy layer would return 403 for the same case. Route wiring
  should prefer this module's 404.
- The subject carries `clientId`; both entry points call
  `requireOwnClientOr404(actor, subject.clientId)` for a Demand / Incident, so a
  guest reaching another client's subject gets a `NotFoundError` (existence not
  revealed). Internal actors pass through.
- Beyond that ownership check, `listComments` does **not** re-authorize subject
  visibility. The caller runs `authorize` (or the view check) first;
  `listComments` then only filters rows by `visibleToClient` for a guest.

### `src/server/modules/comment/serialize.ts`

Role-aware view of one `Comment` row. Internal reader sees the author's real id
and name plus the `visibleToClient` flag; a guest sees neither — a guest author
shows as their own display name, **any non-guest author is masked to `"Keel
team"`** (a GUEST allowlist, not an INTERNAL denylist).

```ts
export type SerializedComment =
  | {
      id: string;
      body: string;
      visibleToClient: boolean;
      authorId: string;
      authorName: string;
      createdAt: string;
    }
  | { id: string; body: string; author: string; createdAt: string };

// `row` is a `Comment` with `author: { kind: $Enums.UserKind; displayName:
// string }` included (local type `CommentWithAuthor`, not exported).
export function serializeComment(
  actor: Actor,
  row: CommentWithAuthor,
): SerializedComment;
```

---

## 5. Refs

### `src/server/ids/ref.ts`

Human-facing reference allocator. Atomic `INSERT … ON CONFLICT DO UPDATE … + 1`
against the `Counter` table; returns `DEM-0001`, `INC-0002`, `CHG-0003`
(zero-padded to four digits, then grows). Must run inside the same transaction as
the row it labels.

```ts
export function nextRef(
  tx: PrismaTransaction,
  prefix: "DEM" | "INC" | "CHG",
): Promise<string>;
```

---

## 6. Sessions & actor loading

### `src/server/auth/session.ts`

The whole of Keel's session handling. An opaque 32-byte token lives in the
`authjs.session-token` cookie and indexes one `Session` row; the column stores
its **SHA-256**, every lookup hashes its argument first. Each function takes an
optional trailing `client` so a caller can run inside a `$transaction`.

```ts
export { SESSION_COOKIE } from "@/lib/http/cookies"; // "authjs.session-token"

/** 30-day session lifetime, slid forward by `touchSession`. */
export const SESSION_MAX_AGE_MS: number;

/** Returns the RAW token once (for the cookie); only its digest is stored. */
export function createSession(
  userId: string,
  meta?: { userAgent?: string; ip?: string },
  client: PrismaTransaction = prisma,
): Promise<{ token: string; expires: Date }>;

/** No explicit return annotation in source; the inferred type is shown. The
 *  `findUnique` uses `include: { user: true }`, so `session.user` is populated
 *  too. `null` for an expired session or a deactivated user. */
export function getSessionAndUser(
  token: string,
  client: PrismaTransaction = prisma,
): Promise<{ session: Session & { user: User }; user: User } | null>;

/** Idempotent — a token that is already gone is not an error. */
export function destroySession(
  token: string,
  client: PrismaTransaction = prisma,
): Promise<void>;

/** Sliding expiry. `updateMany` with an `expires > now` guard, so an
 *  expired-but-unswept row can never be revived by call order. */
export function touchSession(
  token: string,
  client: PrismaTransaction = prisma,
): Promise<void>;
```

### `src/server/auth/actor.ts`

Turning a user id into an `Actor`, and reading the current request's actor.
`withRequest` (§7) builds the `Actor` shape inline and stashes it on the context,
so `getActor()` normally answers without a query; `loadActor` is the fallback and
the integration-harness seam.

```ts
/** No usable actor: no session, or the user behind one is gone / deactivated.
 *  `withRequest`'s error mapper turns this into a 401. */
export class UnauthenticatedError extends Error {}

export function loadActor(
  userId: string,
  client: PrismaTransaction = prisma,
): Promise<Actor>;

/** Prefers the actor `withRequest` stashed; else loads from `actorId` on the
 *  context. Throws `UnauthenticatedError` when there is no actor at all. */
export function getActor(): Promise<Actor>;

/** Like `getActor` but `null` instead of throwing when unauthenticated. A
 *  genuine load failure (DB down) still propagates. */
export function getActorOrNull(): Promise<Actor | null>;
```

### `src/server/auth/current.ts`

Actor resolution for **React Server Components and layouts** — the RSC-side
counterpart to `actor.ts`. Reads the session cookie via `next/headers` and
resolves it against the database. `getActor()` / `getActorOrNull()` above do
**not** work in an RSC render: they read the `withRequest` request context, and
Next 15 does not run RSC renders inside it. Both functions here return `null`
(never throw) when there is no usable session — a deactivated user or an
expired / unknown token included. Do **not** call these from an `api/**` route
(use `getActor()` inside `withRequest`), and do not call an audit-writing
service from a server component (`writeAudit` needs the request context).

```ts
import type { $Enums } from "@prisma/client";

export type Me = {
  id: string;
  kind: $Enums.UserKind;
  hats: $Enums.Hat[];
  clientId: string | null;
  displayName: string;
  email: string;
};

/** The current request's actor, for server components / layouts. */
export function getCurrentActor(): Promise<Actor | null>;

/** Like `getCurrentActor`, plus `displayName` + `email` for the AppShell user
 *  block. */
export function whoami(): Promise<Me | null>;
```

### `src/server/auth/credentials.ts`

The one place a password is checked. Creates no session, sets no cookie — a pure
function of `(client, credentials)`. Every failure (wrong password, deactivated
user, unknown email) returns the same `null` after the same argon2 work, so the
401 never reveals which happened.

```ts
export type Credentials = { email: string; password: string };

export function verifyCredentials(
  client: PrismaTransaction,
  input: Credentials,
): Promise<{ id: string } | null>;
```

### `src/server/auth/login.ts`

The login use case: verify, create the session, emit the audit event
(`auth.login` or `auth.login_failed`). The session row and its event commit or
roll back together.

```ts
export type LoginResult =
  { ok: true; token: string; expires: Date } | { ok: false };

/** Callers must already be inside `runWithContext` — `writeAudit` stamps
 *  `requestId` from it. */
export function login(
  input: Credentials,
  meta?: { userAgent?: string; ip?: string },
): Promise<LoginResult>;
```

---

## 7. HTTP plumbing

### `src/lib/api/with-request.ts`

The wrapper every `api/**` route handler goes through. Per request: take (or
mint) `x-request-id`; resolve the session cookie to `{ session, user }` and slide
its expiry; build the `Actor`; open the request context with request id + actor
id + actor stashed; run the handler. Everything from the cookie read onward sits
in one `try/catch` that funnels through `mapError`.

```ts
export type RequestContext = { requestId: string; actor: Actor | null };

export function withRequest(
  handler: (req: Request, ctx: RequestContext) => Promise<Response> | Response,
): (req: Request) => Promise<Response>;
```

### `src/lib/api/errors.ts`

The single place a thrown error becomes an HTTP response. Branches run
most-specific first, above a generic 500 (which is also `logger.error`'d).

```ts
export function mapError(e: unknown): Response;
```

| thrown                 | status | JSON body                                  |
| ---------------------- | ------ | ------------------------------------------ |
| `UnauthenticatedError` | 401    | `{ error: "unauthenticated" }`             |
| `ZodError`             | 400    | `{ error: "invalid", issues }`             |
| `ForbiddenError`       | 403    | `{ error: "forbidden" }`                   |
| `NotFoundError`        | 404    | `{ error: "not_found" }`                   |
| `GoneError`            | 410    | `{ error: "gone" }`                        |
| `SegregationError`     | 409    | `{ error: "segregation", overrideAction }` |
| anything else          | 500    | `{ error: "internal" }`                    |

### `src/lib/api/client.ts`

The browser-side typed `fetch` wrapper — the client mirror of `mapError`. Client
components call `apiFetch` instead of hand-rolling `fetch()` with `as` casts. It
runs in the browser and imports nothing server-only (`errors.ts`,
`with-request.ts`, Prisma).

```ts
import type { ZodType } from "zod";

/** The JSON error body every route produces via `mapError` (table above). */
export type ApiErrorBody = {
  error?: string;
  overrideAction?: string;
  issues?: unknown;
};

/** A non-2xx response. `body` is the parsed JSON error body, or `null`. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody | null,
  ) {
    super(`api ${status}`);
  }
}

export type ApiFetchOptions<T> = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown; // serialised as JSON; sets content-type when present
  schema?: ZodType<T>; // parses (and types) the 2xx body
  signal?: AbortSignal;
};

export function apiFetch<T = unknown>(
  path: string,
  opts?: ApiFetchOptions<T>,
): Promise<T>;
```

- Non-2xx → `throw new ApiError(status, body)`, `body` being the parsed JSON
  error body or `null` when it was not JSON. `ApiErrorBody` lines up with the
  `mapError` table above.
- `204`, or any other empty 2xx body → resolves to `undefined`.
- `schema` given → the 2xx body is `schema.parse`d; a wire shape that fails
  throws that schema's `ZodError`, **not** an `ApiError`.
- A transport failure (offline, DNS, aborted `signal`) rejects with `fetch`'s
  own error, untouched — tell it from a bad response with `instanceof ApiError`.

**Response-schema convention** (`src/lib/api/schemas/README.md`): every endpoint
has a request schema (`<verb><Noun>Body`); where a client cares about the
response shape, a response schema (`<noun>Response`). Client components call
`apiFetch(path, { schema: <noun>Response })`. Phase 0's schema files (`auth`,
`sessions`, `invites`) predate this and are not retrofitted.

### `src/server/db/errors.ts`

Typed Prisma error helpers. Used by domain code (plan-03's convert idempotency, plan-01's redeem race) to detect constraint violations.

```ts
/** Returns true iff `e` is a P2002 unique-constraint violation. If `target` is
 *  given, narrows to that constraint field only. */
export function isUniqueViolation(e: unknown, target?: string): boolean;

/** Returns true iff `e` is a P2025 not-found error. */
export function isNotFound(e: unknown): boolean;
```

### `src/lib/http/cookies.ts`

Cookie name + a `Request`-header cookie reader, shared between the Edge
middleware and Node-runtime code. Zero imports on purpose.

```ts
/** Purpose-built auth kept the Auth.js name so a later move back would not
 *  invalidate live cookies. */
export const SESSION_COOKIE = "authjs.session-token";

/** Read one cookie off a `Request`'s `Cookie` header, or `null`. A malformed
 *  percent-encoding is treated as no cookie. */
export function readCookie(req: Request, name: string): string | null;
```

### `src/lib/api/rate-limit.ts`

Fixed-window request counter, in process memory. Per instance only (N instances
allow N × `max`); a restart clears every bucket. It trusts whatever key the
caller derives — only meaningful behind a proxy that sets `x-forwarded-for`
itself.

```ts
/** Record one hit against `key`; `true` while under `max` in the current
 *  `windowMs`, `false` once over — callers read `if (!rateLimit(...)) return
 *  429`. */
export function rateLimit(key: string, max: number, windowMs: number): boolean;
```

---

## 8. Health

### `src/server/health/readiness.ts`

The readiness probe behind `GET /api/readyz`. Two checks, both required for `ok`:
**db** (`SELECT 1` succeeds) and **migrations** (every folder in
`prisma/migrations/` has an applied row — a folder with no row means code shipped
ahead of its migration → `"pending"`; an applied row with no folder is still
`"ok"`, the normal mid-rollout state). `deps` is a test seam.

```ts
// Local type (not exported):
// type Checks = { db: "ok" | "error"; migrations: "ok" | "pending" | "error" };

export function checkReadiness(deps?: {
  db?: Pick<PrismaClient, "$queryRaw">;
  migrationsDir?: string;
}): Promise<{ ok: boolean; checks: Checks }>;
```

Route surface (`src/app/api/*/route.ts`):

- `GET /api/healthz` — liveness. No dependency checks, no DB. Always
  `200 { status: "ok" }`. Listed in `src/middleware.ts` PUBLIC.
- `GET /api/readyz` — `200 { status: "ok", checks }` when `ok`, else
  `503 { status: "unavailable", checks }`. Listed in PUBLIC.

---

## 9. Context

### `src/server/context.ts`

The per-request `AsyncLocalStorage`. `withRequest` opens it; `writeAudit`,
`getActor`, and the loggers read it. A context opened by hand (the login route)
may carry only `requestId`.

```ts
type Ctx = {
  requestId: string;
  actorId?: string | null;
  actor?: Actor | null; // stashed by withRequest so getActor() needs no query
};

export function runWithContext<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T>;

/** Throws `"no request context"` when called outside `runWithContext`. */
export function getRequestId(): string;

export function getActorId(): string | null;
export function setActorId(id: string): void;

/** The Actor `withRequest` stashed, or `null`. `getActor()` prefers this. */
export function getContextActor(): Actor | null;
```

---

## 10. Component prop types

All under `src/components/<Name>/<Name>.tsx`, re-exported from each
`<Name>/index.ts`. `ReactNode` is `import type { ReactNode } from "react"`.

### `AppShell` — `src/components/AppShell/AppShell.tsx`

Full-height two-column shell. Pure layout — a **server component** (no state, no
effects). The bottom-bar layout below 920px is entirely CSS.

```ts
export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
  badge?: number;
};

export type AppShellProps = {
  nav: NavItem[];
  currentKey: string;
  user: { name: string; sub: string };
  topbar?: ReactNode;
  children: ReactNode;
};
```

### `Drawer` — `src/components/Drawer/Drawer.tsx`

Right-hand detail drawer over `@radix-ui/react-dialog` (focus trap,
Escape-to-close, scrim-click-to-close via `onClose`, unmounts when `open` is
false). Client component.

```ts
export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  idLabel: string;
  children: ReactNode;
};
```

### `Toasts` — `src/components/Toasts/Toasts.tsx`

Module-level store so `toast()` can be called from anywhere without a hook.
`ToastProvider` renders the fixed live region — mount once near the app root.
Lifetime ~2.5s. Client component.

```ts
/** Show a transient message. Auto-dismisses after ~2.5s. */
export function toast(message: string): void;

// ToastProvider takes `{ children?: ReactNode }` (inline, no exported prop type).
export function ToastProvider(props: { children?: ReactNode }): ReactNode;
```

### `Tile` — `src/components/Tile/Tile.tsx`

Single metric tile. A trailing unit is the caller's job: pass it inside `value`
as `<>41<small>m</small></>`. Server component.

```ts
export type TileTone = "ok" | "warn" | "crit" | "info";

export type TileProps = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: TileTone;
};
```

### `Panel` — `src/components/Panel/Panel.tsx`

Bordered card: header (title + optional count) and a body. `pad` switches the
body from the tight 6px (list content) to 16px. Server component.

```ts
export type PanelProps = {
  title: ReactNode;
  count?: ReactNode;
  pad?: boolean;
  children: ReactNode;
};
```

### `Pill` family — `src/components/Pill/Pill.tsx`

All server components. `Pill` is a status chip (`dot` prepends a filled circle);
the other three take a single enum and render its text (CSS supplies casing /
bullet).

```ts
export type PillTone = "ok" | "warn" | "crit" | "info" | "accent";
export type PillProps = {
  tone: PillTone;
  dot?: boolean;
  children: ReactNode;
};

export type Priority = "P1" | "P2" | "P3" | "P4";
export type PriorityTagProps = { priority: Priority };

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type RiskLabelProps = { level: RiskLevel };

export type Env = "dev" | "test" | "staging" | "prod";
export type EnvTagProps = { env: Env };
```

### `DataTable` — `src/components/DataTable/DataTable.tsx`

Generic scrollable table. Client component. `onRowClick` is **optional** — set it
and each row is activatable through a visually-hidden `<button>` in its first
cell (the `<tr>` keeps `role="row"`); omit it for a read-only data display and
the rows are inert. All cell content comes from `column.cell`; the component
owns only the frame, header, and row affordance. See **Consumer notes**.

```ts
export type Column<R> = {
  key: string;
  header: string;
  /** Optional CSS width for the column's <col> (e.g. "80px", "20%"). */
  width?: string;
  cell: (row: R) => ReactNode;
};

export type DataTableProps<R> = {
  columns: Column<R>[];
  rows: R[];
  getRowId: (row: R) => string;
  /** Row activation. Optional — omit for a read-only table (rows carry no
   *  affordance at all). When set, each row gets a visually-hidden activator
   *  <button> in its first cell. */
  onRowClick?: (row: R) => void;
  /** Accessible name for the table (dashboards render several per page). Also
   *  seeds each row activator's label: `Open <label>: <first-column text>`. */
  label?: string;
};
```

### `LifecyclePips` — `src/components/DataTable/LifecyclePips.tsx`

Row of tiny dots showing lifecycle progress. Decorative — pair it with a text
status pill for the accessible label. Server component.

```ts
export type LifecyclePipsProps = {
  stages: string[];
  currentIndex: number;
  parkedIndex?: number;
};
```

### `ActivityFeed` — `src/components/ActivityFeed/ActivityFeed.tsx`

Vertical activity feed with a connector rail. Server component.

```ts
export type ActivityItem = {
  id: string;
  text: ReactNode;
  meta: string;
  /** CSS colour for the timeline dot (e.g. "var(--warn)"). */
  tone?: string;
};

export type ActivityFeedProps = {
  items: ActivityItem[];
};
```

### `Timeline` — `src/components/Timeline/Timeline.tsx`

Time-stamped event list with a left connector rail. Server component. `TimelineItem`
has no id — the list is static and presentational, keyed by index.

```ts
export type TimelineItem = {
  time: string;
  text: ReactNode;
};

export type TimelineProps = {
  items: TimelineItem[];
};
```

### `LifecycleStepper` — `src/components/LifecycleStepper/LifecycleStepper.tsx`

Vertical rail of stages, each with its exit-gate checklist and — on the current
stage — a gated Advance button. Client component. Stage state is derived from
`currentStageKey` and array order unless a `Stage.state` override is set. See
**Consumer notes**.

```ts
export type GateItem = {
  key: string;
  label: string;
  hint?: string;
  done: boolean;
};

export type Stage = {
  key: string;
  label: string;
  purpose: string;
  gate: GateItem[];
  /** Override the state derived from `currentStageKey` + array order. `"blocked"`
   *  marks a stage the server reports stuck; `"reverted"` on every stage shows a
   *  rolled-back change. An explicit `state` wins over the derived one, and the
   *  stage is then inert — no interactive gate boxes, no Advance button. */
  state?: "done" | "current" | "upcoming" | "blocked" | "reverted";
};

export type LifecycleStepperProps = {
  stages: Stage[];
  currentStageKey: string;
  /** Server-computed. The component never recomputes it from gate state. */
  canAdvance: boolean;
  /** Shown under a disabled Advance once every current-stage gate is checked —
   *  the non-gate reason the server knows (approval pending, no window). While
   *  gates are incomplete the gate-count hint wins and this is not shown. */
  blockedReason?: string;
  /** `done` is the NEXT value for the gate item. */
  onToggleGate?: (stageKey: string, gateKey: string, done: boolean) => void;
  onAdvance?: (fromStageKey: string) => void;
  readOnly?: boolean;
};
```

### `ThemeProvider` — `src/components/ThemeProvider/ThemeProvider.tsx`

Client. Reconciles React state with the `keel-theme` cookie after mount (the
pre-paint script in `layout.tsx` avoids the flash). Never touches `matchMedia` —
no cookie means the DOM is left untouched and `@media (prefers-color-scheme)`
decides. `useTheme` throws outside a provider.

```ts
export type Theme = "light" | "dark" | "system";

export function ThemeProvider(props: { children: ReactNode }): ReactNode;

// ThemeContextValue is local (not exported).
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void };

/** Cycles light → dark → system → light. */
export function ThemeToggle(): ReactNode;
```

---

## Consumer notes

Behaviour that is not visible in the type signatures. From Phase 0 review
findings.

### DataTable

- **`onRowClick` is optional.** Omit it for a read-only table (a dashboard data
  display): the rows then have no activator, no `<tr>` click handler, no
  affordance — the table is inert. Team D's read-only registers must not pass a
  no-op.
- When `onRowClick` is set, the row affordance is a **visually-hidden `<button>`
  as the first child of the first cell**, not `role="button"` on the `<tr>` (a
  button cannot contain `<td>` gridcells — invalid ARIA). The `<tr>` keeps its
  native `role="row"` and gets **no `tabIndex` and no `onKeyDown`**. Keyboard:
  Tab to the button, Enter / Space to activate. Mouse: a guarded `onClick` on
  the `<tr>` fires `onRowClick` for a click anywhere on the row _except_ one
  whose `event.target.closest("a,button,input,select,textarea,label")` is
  truthy.
- **An actions column just works.** A `cell` that renders its own link, button
  or input is skipped by that guard and receives only its own click — **no
  `e.stopPropagation()` and no dedicated non-clickable column needed** (this
  supersedes the Phase 0 rule). The control must be one of those real elements;
  a bare `<div onClick>` in a cell would still fall through to the row.
- Always pass `label` — it is the table's accessible name (dashboards render
  several tables per page) **and** seeds each row activator's accessible name,
  `Open <label>: <first-column text>` (or just `Open <label>` when the first
  column does not render plain text, e.g. a wrapped/element cell).

### LifecycleStepper

- Only the **current** stage's gate checkboxes are interactive. Past- and
  future-stage boxes are disabled and render checked / unchecked purely from each
  item's `done` value — the component never overrides it.
- The component **trusts the caller's `item.done`** for past and future stages —
  it does not force a past stage's gates to checked. If you want a completed
  past stage to read as done, pass `done: true`.
- `canAdvance` is **server-computed and taken verbatim**. The component never
  derives it from gate state; a fully-checked gate with `canAdvance={false}`
  stays disabled. Pass `blockedReason` to explain why — it renders under the
  button **only once every current-stage gate is checked** (while
  `doneCount < total` the gate-count hint `"n/total gate checks to advance"`
  wins and `blockedReason` is not shown). Without it the component stays silent,
  as it cannot infer the reason.
- `readOnly` disables every gate box and hides the Advance button entirely.
- If `currentStageKey` matches **no** stage, every stage renders as `upcoming`
  and no Advance button shows. No crash.
- An explicit `Stage.state` **wins over the derived state** — the component
  renders `stage.state ?? <derived>`. Such a stage is inert: its gate boxes are
  never interactive and it never shows an Advance button, even if
  `currentStageKey` also points at it. `"blocked"` tints the node + label amber
  (`--warn`), `"reverted"` muted red (`--crit`); plan-03 pins every stage to
  `"reverted"` after a rollback and one stage to `"blocked"` when the pipeline
  is stuck.

### Route / middleware surface

- `src/middleware.ts` `PUBLIC` regexes (no session cookie required):
  `/api/healthz`, `/api/readyz`, `/api/auth/login`,
  `/api/guest-invites/<token>/redeem`, `/login`, `/portal/invite/…`, and
  `/dev/…` **only when `NODE_ENV !== "production"`**. In production a `/dev/*`
  request is a bare `404` before the auth check.
- Every response carries a fresh `x-request-id` UUID; `withRequest` reads it
  back off the forwarded request headers.

### Test infrastructure

- **Migrate once, clone per file.** `src/test/global-setup.ts` (Vitest
  `globalSetup`) runs one `prisma migrate deploy` per suite run, into a template
  database `keel_test_tmpl`, then seals it (`ALLOW_CONNECTIONS false`).
  `src/test/db.ts` (`withTestDb()`) then gives each test **file** its own
  disposable database via `CREATE DATABASE test_<hex> TEMPLATE keel_test_tmpl` —
  a file copy, not a migration. `withTestDb()` still returns a getter:
  `const db = withTestDb(); db()`.
- **Every `CREATE` / `DROP DATABASE` is serialised behind a Postgres advisory
  lock** (`db-admin.ts`, `DDL_LOCK_KEY`). This is load-bearing, not caution:
  running them concurrently **crashes the whole cluster** —
  `server process … exited with exit code 2`, every connection dropped,
  restart into recovery. Reproduced with plain `psql` and no vitest: 75 serial
  create+drop cycles are fine, 13 concurrent sessions crash it, and 13
  concurrent sessions taking the lock are fine again. ~13 vitest workers hit
  `beforeAll` together, which is exactly the failing shape. Serialising costs
  under a second per run.
- **A test file never drops its own database**; its `afterAll` only
  `$disconnect()`s. `global-setup.ts` owns all cleanup: one sweep at teardown,
  after every worker has exited, which keeps ~26 forced checkpoints
  (`DROP DATABASE` always requests `CHECKPOINT_IMMEDIATE | FORCE | WAIT`) off
  the critical path. The cost is that every clone coexists for the length of a
  run, ~9 MB each — ~226 MB peak for the full suite.
- The clone carries the migrations' **table privileges**, not just their tables,
  so the `keel_app` REVOKEs from `audit_grants` /
  `audit_default_privileges` are live in every `test_<hex>` database.
  `src/test/db.test.ts` pins that directly; `append-only.test.ts` and
  `record-of-fact.test.ts` prove it from `keel_app`'s own privilege level.
- `global-setup.ts` is self-healing: it drops the template and sweeps every
  leaked `test_*` database at the **start** of a run (a hard-killed run never
  reaches teardown), and again at the end. `src/test/db-admin.ts` holds the
  shared plumbing and imports no vitest — globalSetup and the workers are
  separate processes, so everything they must agree on is a compile-time
  constant there. `CREATE`/`DROP DATABASE` retry on SQLSTATE 55006 / 53300 /
  57P03 and the cluster-restart messages, with jittered backoff; nothing else is
  retried, and a retry caused by a restart logs a warning rather than hiding it.
  `createTestDb` drops-then-creates so a killed `CREATE` can be retried without
  hitting `42P04 already exists`.
- Route-handler tests: `withRouteTestDb()` in `src/test/route-db.ts`. A route
  handler may not import a Prisma client, so it reaches the DB through the
  `@/server/db/client` singleton, and a route test must mock that module.
  `vi.mock` is hoisted above every import and cannot even name an imported
  helper, so the file keeps two statements — see
  `src/app/api/guest-invites/__tests__/create.route.test.ts`:

  ```ts
  vi.mock("@/server/db/client", async () =>
    (await import("@/test/route-db")).routeDbClientMock(),
  );
  const { db, asActor } = withRouteTestDb();
  ```

  `asActor(user)` mints a real `Session` row and returns
  `{ cookie, headers, token, actor, run }` — `headers` spreads into a `Request`
  init, `run()` wraps a direct service call in `runWithContext`. The six Phase 0
  tests written before this helper still carry the long form; their file headers
  point here.

- `route-db.ts` shares `DB_NAME` as module state between the `vi.mock` factory
  and `withRouteTestDb()`, so `vitest.config.ts` sets **`isolate: true`
  explicitly** rather than relying on the default — a shared module instance
  would collide two route files onto one test database. `withRouteTestDb()` also
  throws if called twice in one file.

- Component tests: first line `/** @vitest-environment jsdom */`, then
  `import { afterEach } from "vitest"; import { cleanup } from
"@testing-library/react"; afterEach(cleanup);`. jsdom shims live in
  `src/test/dom.ts` (`stubMatchMedia`, `stubRadixEnv`).
