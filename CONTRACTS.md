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
spread into a guest read (`{}` for an internal actor). `assertVisibleToGuest`
throws `NotFoundError` when a loaded row is not the guest's own client's.

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

Role-aware serialisation. `serializeFor` returns the row unchanged for an
internal actor; for a guest it strips `internalOnlyKeys` and applies an optional
`guestTransform`. `assertNoInternalKeys` is the test-time guard that no
internal-only key survived.

```ts
export type SerializerConfig<T> = {
  internalOnlyKeys: readonly (keyof T)[];
  guestTransform?: (row: T) => Partial<T> & Record<string, unknown>;
};

export function serializeFor<T extends Record<string, unknown>>(
  actor: Actor,
  row: T,
  cfg: SerializerConfig<T>,
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
`payload -> { subject, text, html }`. Phase 0 ships only `guest_invite`.

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
the guest portal. `subjectType` is stored capitalised. The caller is expected to
have already run `authorize(actor, "comment.create", subject)` (or the matching
view check); the guards here are a safety net, not the primary gate.

```ts
export type CommentSubjectType = "Demand" | "Incident" | "Change";

/**
 * Create a comment on `subjectId`, audit it, and optionally notify one user.
 * Returns the RAW, unserialized `Comment` row — a route handler MUST pass it
 * through `serializeComment(actor, …)` (or re-list via `listComments`) before it
 * reaches a response.
 */
export function addComment(
  tx: PrismaTransaction,
  input: {
    actor: Actor;
    subjectType: CommentSubjectType;
    subjectId: string;
    body: string;
    /** Internal author's choice; default false. Ignored for guests. */
    visibleToClient?: boolean;
    notifyUserId?: string;
  },
): Promise<Comment>; // Prisma row type

export function listComments(
  actor: Actor,
  subjectType: string,
  subjectId: string,
  client: PrismaClient = prisma,
): Promise<SerializedComment[]>;
```

**Gotchas.**

- A **guest** author's comment is always forced `visibleToClient = true`
  (`input.visibleToClient` is ignored for a guest).
- A guest calling `addComment` **or** `listComments` with `subjectType ===
"Change"` gets a `NotFoundError` (a guest must never learn a Change exists) —
  even though the policy layer would return 403 for the same case. Route wiring
  should prefer this module's 404.
- `listComments` does **not** re-authorize subject visibility beyond that Change
  guard. The caller runs `authorize` (or the view check) first; `listComments`
  then only filters rows by `visibleToClient` for a guest.

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

Generic scrollable table. Client component — rows carry `onRowClick` and are
keyboard-activatable. All cell content comes from `column.cell`; the component
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
  onRowClick: (row: R) => void;
  getRowId: (row: R) => string;
  /** Accessible name for the table (dashboards render several per page). */
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
stage — a gated Advance button. Client component. Stage state is derived purely
from `currentStageKey` and array order. See **Consumer notes**.

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
};

export type LifecycleStepperProps = {
  stages: Stage[];
  currentStageKey: string;
  /** Server-computed. The component never recomputes it from gate state. */
  canAdvance: boolean;
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

- Rows are `<tr role="button">` with `onClick` **and** an Enter / Space
  `onKeyDown`. If a `cell` renders its own interactive element (a link or
  button), that element's handler **must call `e.stopPropagation()`**, or use a
  dedicated non-clickable actions column — otherwise the row's `onRowClick` also
  fires on every click of the inner control.
- Always pass `label` — it is the table's accessible name, and dashboards render
  several tables per page.

### LifecycleStepper

- Only the **current** stage's gate checkboxes are interactive. Past- and
  future-stage boxes are disabled and render checked / unchecked purely from each
  item's `done` value — the component never overrides it.
- The component **trusts the caller's `item.done`** for past and future stages —
  it does not force a past stage's gates to checked. If you want a completed
  past stage to read as done, pass `done: true`.
- `canAdvance` is **server-computed and taken verbatim**. The component never
  derives it from gate state; a fully-checked gate with `canAdvance={false}`
  stays disabled (and shows no hint, because the reason — approval, window — is
  not something the component can know).
- `readOnly` disables every gate box and hides the Advance button entirely.
- If `currentStageKey` matches **no** stage, every stage renders as `upcoming`
  and no Advance button shows. No crash.

### Route / middleware surface

- `src/middleware.ts` `PUBLIC` regexes (no session cookie required):
  `/api/healthz`, `/api/readyz`, `/api/auth/login`,
  `/api/guest-invites/<token>/redeem`, `/login`, `/portal/invite/…`, and
  `/dev/…` **only when `NODE_ENV !== "production"`**. In production a `/dev/*`
  request is a bare `404` before the auth check.
- Every response carries a fresh `x-request-id` UUID; `withRequest` reads it
  back off the forwarded request headers.

### Test infrastructure

- `src/test/db.ts` (`withTestDb()`) spawns a `prisma migrate deploy` child
  process per test **file**, into a uniquely-named disposable Postgres schema
  (`test_<hex>`), and drops it on teardown. This applies the full migration
  chain from zero on every `pnpm test` run.
- Running the full suite (~48 files, forks pool) can transiently fail a batch
  with `prisma migrate deploy failed for schema "test_…"` under load — this is
  contention, not a real failure. Re-run. A shared template DB or serialised
  migrate step is a Phase 2 improvement.
- Component tests: first line `/** @vitest-environment jsdom */`, then
  `import { afterEach } from "vitest"; import { cleanup } from
"@testing-library/react"; afterEach(cleanup);`. jsdom shims live in
  `src/test/dom.ts` (`stubMatchMedia`, `stubRadixEnv`).
