# Incident Management — Implementation Plan (Phase 1, plan-02)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the incident lifecycle end to end — report (internal + guest) → categorise (impact × urgency → priority) → assign → work → resolve → close → reopen — with `dueAt` + a derived `overdue` flag, the incident register and drawer, the guest portal incident pages, and the once-only overdue notification.

**Architecture:** Identical to plan-01. Every write goes `route → withRequest → service(actor, tx, input) → authorize + domain write + writeAudit + emitNotification` inside one `runInTransaction`. Reads compose `authorize` (or `assertVisibleToGuest`) + a role-aware **allowlist** serializer. UI is server components that call the service directly (RSC) or the route handlers (client islands via `apiFetch`). The incident module owns `Incident`; it never writes `Change` or `ChangeIncidentLink` (plan-03 owns those) — it only *reads* the join through `listLinkedChanges`.

**Tech Stack:** Next 15.5.24 App Router, React 19.1.0, TypeScript strict + `noUncheckedIndexedAccess`, Prisma 6.19.3 / PostgreSQL 16, Zod ^4.5.4, Vitest 3.2.7, `@testing-library/react` ^16, CSS Modules (no Tailwind), Radix primitives via the ported components.

**Spec:** [`specs/02-incident-management.md`](specs/02-incident-management.md). Cross-refs: [`specs/data-model.md`](specs/data-model.md) §"Incident", [`specs/00-foundation.md`](specs/00-foundation.md) §3–§4, [`specs/05-notifications.md`](specs/05-notifications.md), [`specs/07-guest-portal.md`](specs/07-guest-portal.md) §4.3–§4.5, [`../CONTRACTS.md`](../CONTRACTS.md) (the authoritative Phase 0 + Phase 1 interface freeze — read it, and read `plan-01-demand.md` and the shipped `src/server/modules/demand/**` as the working pattern before starting Task 1).

## Global Constraints

- **Node 22 LTS** target. Local dev on Node 24 tolerated.
- **No Tailwind, no component library.** UI uses `src/components/**` + CSS Modules. Colours come only from `tokens.css` custom properties — never a raw hex in a component.
- **Prisma boundary (eslint-enforced):** `@prisma/client` **value** imports only under `src/server/db/**`. `src/server/**` elsewhere uses the `prisma` singleton from `@/server/db/client` and `import type` for Prisma types. `src/app/**` imports neither — route handlers and pages call into `src/server/**`.
- **Every `api/**` route handler is wrapped in `withRequest`** (`@/lib/api/with-request`). A dynamic segment (`[id]`) cannot ride the `export const POST = withRequest(...)` shorthand — use the `export async function POST(req, { params })` form that awaits `params` then calls `withRequest(...)(req)` (see `src/app/api/demands/[id]/decision/route.ts`).
- **Every domain write runs inside `runInTransaction`** (`@/server/db/tx`) and calls `writeAudit` for its state change in the same `tx`. Notifications go through `emitNotification` in the same `tx`.
- **Request bodies are parsed with a Zod schema** from `src/lib/api/schemas/incidents.ts`: `SCHEMA.parse(await req.json().catch(() => null))`. A parse failure throws `ZodError` → `mapError` → 400 `{ error: "invalid", issues }`. Zod 4 API: `z.enum([...])`, `z.iso.datetime()`.
- **Every `"use client"` component that talks to a route handler uses `apiFetch<T>`** from `@/lib/api/client` — never a bare `fetch`, never `as any` on the response. `apiFetch` throws `ApiError` on non-2xx (parsed body attached), returns `undefined` for 204 / empty body.
- **Guest output is an allowlist.** Use `serializePick` (`@/server/policy/serialize`) with an explicit `guestKeys`. Never `serializeFor` for guest-facing output. A column added to the row later must stay hidden from a guest until deliberately added to `INCIDENT_GUEST_KEYS`.
- **Guest reads are scoped server-side.** `listIncidents` spreads `...scopeToClient(actor)` into the `where`; `getIncidentForActor` runs `assertVisibleToGuest(actor, row)` **before** `authorize` so a cross-client hit is a 404, never a 403.
- **TDD, RED first.** Each task: write the failing test, run it, see it fail for the right reason, implement the minimum, see it pass, commit. Never write implementation before its test.
- **Tests hit the disposable-database harness:** `import { withTestDb } from "@/test/db"` → `const db = withTestDb();`. Open transactions in tests with `db().$transaction(...)`, **not** `runInTransaction`. Route-handler tests use `withRouteTestDb()` from `@/test/route-db` (the two-statement seam — see `src/app/api/demands/__tests__/demands.route.test.ts`). Component tests: first line `/** @vitest-environment jsdom */`, then `afterEach(cleanup)`.
- **Test-actor literals** are typed `const x: Actor = {...}`, **not** `as const` (`as const` gives `hats: readonly []` which fails `tsc` against `Actor.hats: Hat[]`). Seed helpers give every `Client` a unique `name` (`Client.name` is `@unique`).
- **Caveman mode is for chat only.** Code, comments, commit messages, and this plan's prose stay in normal English. Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **`pnpm lint && pnpm typecheck && pnpm test && pnpm build` green before every commit.** `pnpm lint` includes `prettier --check .` — run `pnpm exec prettier --write` on new files first.
- **Enum casing:** the Prisma enums are `SCREAMING_SNAKE` (`Level.HIGH`, `Priority.P1`, `IncidentStatus.IN_PROGRESS`). Spec 02 writes them lowercase in prose — the code uses the enum values.
- **Do NOT stage `.claude/` or `.superpowers/`.** Do NOT run `pnpm dev` alongside `pnpm build`.

---

## Reconciliation rulings (spec 02 vs shipped Phase 0 + plan-01)

These resolve where the spec was written before the code froze. Treat them as part of the spec.

1. **No schema migration.** The `Incident` model already ships in `prisma/schema.prisma` (Phase 0 Task 5) with every column this plan needs: `impact`, `urgency`, `priority`, `status`, `dueAt`, `overdue` (stored, **no** column default), `overdueNotifiedAt`, `resolution`, `resolvedAt`, `closedAt`, `assigneeId` (`onDelete: Restrict`). The `incident.*` policy rules (`src/server/policy/subjects/incident.rule.ts`) and the `incident.*` actions catalogue also already ship, and the authorization matrix (`src/server/policy/__tests__/matrix.cases.ts`) already covers them. plan-02 adds **no** migration and touches the policy layer only if a test in Task 4/5 proves a genuine gap.

2. **`overdue` display is always derived fresh.** The serializer computes `overdue = now > dueAt && status ∉ {RESOLVED, CLOSED}` on every read and never trusts the stored column for display, so a response is never stale. The **stored** `Incident.overdue` column exists only to back the `?overdue=true` list filter and the (plan-04) dashboard count; `sweepOverdueIncidents()` (Task 6) keeps it honest. **Reads never write.**

3. **One create route, actor-selected body.** `POST /api/incidents` serves both. Internal body: `{ title, description, affectedService, impact, urgency }`. Guest body: `{ title, description, affectedService, affectingLevel }` — it does **not** accept `impact` / `urgency`. On a guest create the service sets `impact = MEDIUM`, `urgency = MEDIUM`, `priority = P3` (provisional), and appends the affecting-level answer to `description` verbatim as a trailing line (`\n\nHow much it is affecting you: <affectingLevel>`) — never discarded. The guest sees "Being assessed" for priority until an internal user categorises it (the guest serializer never exposes `priority` at all — "Being assessed" is the portal's copy for the absence). `reportedById` + `clientId` are always server-side from the actor.

4. **Assignee must be internal.** `assignIncident` loads the target user and throws `ForbiddenError("assignee must be an internal user")` unless `kind === "INTERNAL"` and `isActive`. Assigning an incident in `NEW` also advances it to `ASSIGNED` in the same write (no separate `transition` call). Re-assignment is allowed while `NEW` / `ASSIGNED` / `IN_PROGRESS`; assigning a `RESOLVED` / `CLOSED` incident throws `ForbiddenError`.

5. **Categorisation lock.** `impact` / `urgency` are freely editable (and `dueAt` recomputed) while status is `NEW` or `ASSIGNED`. Once the incident is `IN_PROGRESS` or later, `categorizeIncident` requires a non-empty `reason`; the reason is written to the `incident.categorized` audit payload and added as an internal (`visibleToClient: false`) comment. `dueAt` is **not** recomputed after `NEW` / `ASSIGNED` — the clock does not move once work has started (spec §3).

6. **Reopen.** `POST /api/incidents/:id/reopen` with `{ reason }`, action `incident.transition`. `RESOLVED → IN_PROGRESS` any time; `CLOSED → IN_PROGRESS` only within `REOPEN_WINDOW_MS` (14 days measured from `closedAt`) — else `ForbiddenError("the reopen window has closed")`. Reopening clears `resolvedAt` and `closedAt` and leaves `resolution` in place (a re-resolve overwrites it). Internal only (the `DEVELOPER`-hat rule already enforces that).

7. **Guest portal incident pages ship in plan-02** (`/portal/incidents`, `/portal/incidents/:id`, and the incident tab of the submit form) so spec 07 §4.3 / §4.5's "watches both progress in plain language" is testable here. plan-04 adds the portal shell polish, the notification bell, and the unified `/portal/submit` two-tab page — Task 10 ships a working `/portal/incidents/new` form now.

8. **Internal-user emails are deferred; in-app rows are written now.** plan-02 writes every in-app `Notification` row in spec §8. It adds one email template — `incident_status` (guest-safe, payload `{ ref, status }`) — sent to a **guest** reporter on transition / resolve. The internal `incident_assigned` / `incident_overdue` emails (spec 05 §5) are plan-05 wiring; plan-02's `emitNotification` calls for internal recipients pass no `email` block. This mirrors plan-01 (`demand.triage_started` is in-app only).

9. **Overdue sweep runs on an interval, mirroring the outbox worker.** `startOverdueSweeper()` (`src/server/modules/incident/sweep.ts`) is a `globalThis`-guarded `setInterval`, started from `src/server/bootstrap.ts` alongside `startOutboxWorker()`. Poll interval `OVERDUE_POLL_MS` (default 60_000). The function itself (`sweepOverdueIncidents`) is pure of the interval and fully tested directly.

10. **Module location:** `src/server/modules/incident/` (matching `src/server/modules/demand/`, `.../notify/`, `.../comment/`).

11. **Guest audit-feed visibility.** `guestAuditActionLabel` returns a phrase for `incident.create`, `incident.transitioned`, `incident.resolved`, `incident.closed` (and the already-listed `comment.created`); every other `incident.*` action (`categorized`, `assigned`, `reopened`, `overdue`) returns `null` and is dropped from the guest activity timeline.

---

## File Structure

**API / server**

- `src/server/modules/incident/priority.ts` — the impact × urgency → priority matrix, the `dueAt` offsets, and `isOverdue`. Pure, no Prisma. One responsibility: the SLA arithmetic.
- `src/server/modules/incident/state.ts` — `INCIDENT_TRANSITIONS` + `assertTransition` + `REOPEN_WINDOW_MS`. Pure. The one place the state machine lives.
- `src/server/modules/incident/serialize.ts` — `serializeIncident(actor, row, ctx)` (via `serializePick`), `INCIDENT_GUEST_KEYS`, `guestIncidentStatusLabel`, `internalIncidentStatusLabel`, `guestSlaLine`. Pure.
- `src/server/modules/incident/service.ts` — the use cases: `createIncident`, `listIncidents`, `getIncidentForActor`, `listLinkedChanges`, `incidentClientId`, `categorizeIncident`, `assignIncident`, `transitionIncident`, `reopenIncident`. All authz + audit + notify live here.
- `src/server/modules/incident/sweep.ts` — `sweepOverdueIncidents(deps?)` + `startOverdueSweeper()`.
- `src/lib/api/schemas/incidents.ts` — every incident request body as a Zod schema + `z.infer` type.
- `src/app/api/incidents/route.ts` — `POST` (create, actor-selected body), `GET` (list).
- `src/app/api/incidents/[id]/route.ts` — `GET` (one).
- `src/app/api/incidents/[id]/categorize/route.ts` — `PATCH`.
- `src/app/api/incidents/[id]/assign/route.ts` — `POST`.
- `src/app/api/incidents/[id]/transition/route.ts` — `POST`.
- `src/app/api/incidents/[id]/reopen/route.ts` — `POST`.
- `src/app/api/incidents/[id]/comments/route.ts` — `GET` / `POST` (the shared comment module — mirror `src/app/api/demands/[id]/comments/route.ts` exactly, swapping `Demand` → `Incident` and `demandClientId` → `incidentClientId`).

**Server wiring**

- `src/server/audit/labels.ts` — modify: add the `incident.*` entries to `AUDIT_ACTION_LABELS` and the guest subset to `guestAuditActionLabel`.
- `src/server/bootstrap.ts` — modify: call `startOverdueSweeper()`.
- `src/server/modules/notify/templates/index.ts` — modify: register `incident_status`.
- `src/server/modules/notify/templates/incident-status.ts` — create (if templates are one-file-each; otherwise inline in `index.ts` following `demand_decided`'s placement).

**UI — internal register + drawer**

- `src/app/(internal)/incidents/page.tsx` — server component; reads `?status`, `?priority`, `?overdue`, `?mine`; calls `listIncidents`; renders `<IncidentRegister>`.
- `src/app/(internal)/incidents/IncidentRegister.tsx` — `"use client"`; the card list (spec §9.1) + filter chips; card click opens `<IncidentDrawer>`.
- `src/app/(internal)/incidents/IncidentCard.tsx` — `"use client"` or server; one card (severity rail, ref, title, priority tag, affected service, age, `dueAt` countdown, `OVERDUE` badge, assignee).
- `src/app/(internal)/incidents/IncidentDrawer.tsx` — `"use client"`; the `Drawer` with all panels (spec §9.2); `apiFetch` for the GET + every write; re-fetch after each write.
- `src/app/(internal)/incidents/incidents.module.css`, `IncidentDrawer.module.css`.
- `src/app/(internal)/AppShellChrome.tsx` — modify: append the `incidents` `NavItem`.

**UI — guest portal**

- `src/app/portal/(guest)/incidents/page.tsx` — server; guest-scoped list.
- `src/app/portal/(guest)/incidents/[id]/page.tsx` — server; guest-scoped detail (mirror `portal/(guest)/demands/[id]/page.tsx`).
- `src/app/portal/(guest)/incidents/new/page.tsx` — server shell + `<PortalIncidentForm>`.
- `src/app/portal/(guest)/incidents/PortalIncidentList.tsx`, `PortalIncidentDetail.tsx`, `PortalIncidentForm.tsx` — `"use client"` where interaction is needed.
- `src/app/portal/(guest)/incidents/portal-incidents.module.css`.
- Reuse `src/app/portal/(guest)/demands/CommentThread.tsx` (it is subject-agnostic — confirm; if it hard-codes `/api/demands`, lift the base path to a prop in Task 10).

**Seed**

- `prisma/seed.ts` — modify: add `seedDemoIncidents()` behind `NODE_ENV !== "production"`, composing with the existing seed.

**Tests** — colocated: `src/server/modules/incident/__tests__/{priority,state,serialize,service,sweep}.test.ts`, `src/app/api/incidents/__tests__/*.route.test.ts`, `src/app/(internal)/incidents/__tests__/*.test.tsx`, `src/app/portal/(guest)/incidents/__tests__/*.test.tsx`, `src/server/modules/incident/__tests__/lifecycle.integration.test.ts`.

---

## Task 1: Priority matrix + SLA arithmetic (pure)

**Files:**
- Create: `src/server/modules/incident/priority.ts`
- Test: `src/server/modules/incident/__tests__/priority.test.ts`

**Interfaces:**
- Consumes: `$Enums` (type-only, `@prisma/client`).
- Produces:
  ```ts
  export const SLA_HOURS: Record<$Enums.Priority, number>; // P1:4, P2:24, P3:72, P4:168
  export function priorityFor(impact: $Enums.Level, urgency: $Enums.Level): $Enums.Priority;
  export function dueAtFrom(priority: $Enums.Priority, createdAt: Date): Date;
  export function isOverdue(
    row: { dueAt: Date; status: $Enums.IncidentStatus },
    now: Date,
  ): boolean;
  ```

- [ ] **Step 1: Write the failing test** — `priority.test.ts`

```ts
import { expect, test } from "vitest";
import {
  SLA_HOURS,
  dueAtFrom,
  isOverdue,
  priorityFor,
} from "@/server/modules/incident/priority";

test("the nine impact x urgency combinations map per data-model.md", () => {
  // H×H → P1; H×M, M×H → P2; H×L, M×M, L×H → P3; M×L, L×M, L×L → P4
  expect(priorityFor("HIGH", "HIGH")).toBe("P1");
  expect(priorityFor("HIGH", "MEDIUM")).toBe("P2");
  expect(priorityFor("MEDIUM", "HIGH")).toBe("P2");
  expect(priorityFor("HIGH", "LOW")).toBe("P3");
  expect(priorityFor("MEDIUM", "MEDIUM")).toBe("P3");
  expect(priorityFor("LOW", "HIGH")).toBe("P3");
  expect(priorityFor("MEDIUM", "LOW")).toBe("P4");
  expect(priorityFor("LOW", "MEDIUM")).toBe("P4");
  expect(priorityFor("LOW", "LOW")).toBe("P4");
});

test("dueAt is createdAt plus the priority's SLA hours", () => {
  const created = new Date("2026-09-06T00:00:00.000Z");
  expect(dueAtFrom("P1", created).toISOString()).toBe("2026-09-06T04:00:00.000Z");
  expect(dueAtFrom("P2", created).toISOString()).toBe("2026-09-07T00:00:00.000Z");
  expect(dueAtFrom("P3", created).toISOString()).toBe("2026-09-09T00:00:00.000Z");
  expect(dueAtFrom("P4", created).toISOString()).toBe("2026-09-13T00:00:00.000Z");
  expect(SLA_HOURS.P1).toBe(4);
});

test("isOverdue: true past dueAt while open, false for resolved/closed and before dueAt", () => {
  const due = new Date("2026-09-06T04:00:00.000Z");
  const after = new Date("2026-09-06T04:00:01.000Z");
  const before = new Date("2026-09-06T03:59:59.000Z");
  expect(isOverdue({ dueAt: due, status: "IN_PROGRESS" }, after)).toBe(true);
  expect(isOverdue({ dueAt: due, status: "IN_PROGRESS" }, before)).toBe(false);
  expect(isOverdue({ dueAt: due, status: "RESOLVED" }, after)).toBe(false);
  expect(isOverdue({ dueAt: due, status: "CLOSED" }, after)).toBe(false);
  // exactly at dueAt is not yet overdue
  expect(isOverdue({ dueAt: due, status: "NEW" }, due)).toBe(false);
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm test src/server/modules/incident/__tests__/priority` → FAIL (module missing).

- [ ] **Step 3: Implement `priority.ts`**

```ts
import type { $Enums } from "@prisma/client";

/** `dueAt` offsets from creation, per specs/data-model.md §"Incident". Tunable. */
export const SLA_HOURS: Record<$Enums.Priority, number> = {
  P1: 4,
  P2: 24,
  P3: 72,
  P4: 168,
};

/** A small rank so the matrix reads as arithmetic rather than a 3x3 lookup. */
const RANK: Record<$Enums.Level, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

/**
 * Impact x Urgency -> Priority (specs/data-model.md §"Incident"):
 *   H×H → P1
 *   H×M, M×H → P2
 *   H×L, M×M, L×H → P3
 *   M×L, L×M, L×L → P4
 * The sum of the two ranks (2..6) selects the band; the only nuance is that a
 * pair summing to 4 is always P3 (M×M, H×L, L×H) — a plain sum handles that.
 */
export function priorityFor(
  impact: $Enums.Level,
  urgency: $Enums.Level,
): $Enums.Priority {
  const sum = RANK[impact] + RANK[urgency];
  if (sum >= 6) return "P1";
  if (sum === 5) return "P2";
  if (sum === 4) return "P3";
  return "P4"; // sum of 2 or 3
}

export function dueAtFrom(priority: $Enums.Priority, createdAt: Date): Date {
  return new Date(createdAt.getTime() + SLA_HOURS[priority] * 60 * 60 * 1000);
}

const TERMINAL: ReadonlySet<$Enums.IncidentStatus> = new Set([
  "RESOLVED",
  "CLOSED",
]);

/** `now > dueAt AND status NOT IN (RESOLVED, CLOSED)` — spec §3. Exactly at
 *  `dueAt` is not yet overdue. */
export function isOverdue(
  row: { dueAt: Date; status: $Enums.IncidentStatus },
  now: Date,
): boolean {
  return now.getTime() > row.dueAt.getTime() && !TERMINAL.has(row.status);
}
```

- [ ] **Step 4: Run the tests, verify they pass.** Full gate.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/incident/priority.ts src/server/modules/incident/__tests__/priority.test.ts
git commit -m "feat: incident priority matrix and SLA arithmetic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Incident state machine (pure)

**Files:**
- Create: `src/server/modules/incident/state.ts`
- Test: `src/server/modules/incident/__tests__/state.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const INCIDENT_TRANSITIONS: Record<$Enums.IncidentStatus, readonly $Enums.IncidentStatus[]>;
  export function assertTransition(from: $Enums.IncidentStatus, to: $Enums.IncidentStatus): void; // throws ForbiddenError
  export const REOPEN_WINDOW_MS: number; // 14 days
  ```
- The declared edges (spec §4):
  - `NEW → ASSIGNED` (via `assignIncident`)
  - `ASSIGNED → IN_PROGRESS` (via `transitionIncident`)
  - `IN_PROGRESS → RESOLVED` (via `transitionIncident`, needs `resolution`)
  - `RESOLVED → CLOSED` (via `transitionIncident`)
  - `RESOLVED → IN_PROGRESS` (via `reopenIncident`)
  - `CLOSED → IN_PROGRESS` (via `reopenIncident`, within `REOPEN_WINDOW_MS`)

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import {
  INCIDENT_TRANSITIONS,
  REOPEN_WINDOW_MS,
  assertTransition,
} from "@/server/modules/incident/state";
import { ForbiddenError } from "@/server/policy/errors";

test("legal transitions per spec section 4", () => {
  expect(() => assertTransition("NEW", "ASSIGNED")).not.toThrow();
  expect(() => assertTransition("ASSIGNED", "IN_PROGRESS")).not.toThrow();
  expect(() => assertTransition("IN_PROGRESS", "RESOLVED")).not.toThrow();
  expect(() => assertTransition("RESOLVED", "CLOSED")).not.toThrow();
  expect(() => assertTransition("RESOLVED", "IN_PROGRESS")).not.toThrow();
  expect(() => assertTransition("CLOSED", "IN_PROGRESS")).not.toThrow();
});

test("illegal transitions throw ForbiddenError", () => {
  expect(() => assertTransition("NEW", "IN_PROGRESS")).toThrow(ForbiddenError);
  expect(() => assertTransition("NEW", "RESOLVED")).toThrow(ForbiddenError);
  expect(() => assertTransition("IN_PROGRESS", "CLOSED")).toThrow(ForbiddenError);
  expect(() => assertTransition("CLOSED", "CLOSED")).toThrow(ForbiddenError);
  expect(() => assertTransition("ASSIGNED", "NEW")).toThrow(ForbiddenError);
});

test("the reopen window is 14 days", () => {
  expect(REOPEN_WINDOW_MS).toBe(14 * 24 * 60 * 60 * 1000);
  // every status is a key (compile-time Record guarantees it; assert at runtime too)
  expect(Object.keys(INCIDENT_TRANSITIONS).sort()).toEqual(
    ["ASSIGNED", "CLOSED", "IN_PROGRESS", "NEW", "RESOLVED"].sort(),
  );
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `state.ts`**

```ts
import type { $Enums } from "@prisma/client";
import { ForbiddenError } from "@/server/policy/errors";

/**
 * The incident lifecycle state machine (spec 02 §4). Pure — no Prisma, no I/O.
 * `NEW → ASSIGNED` is driven by `assignIncident`; `ASSIGNED → IN_PROGRESS`,
 * `IN_PROGRESS → RESOLVED`, `RESOLVED → CLOSED` by `transitionIncident`;
 * `RESOLVED → IN_PROGRESS` and `CLOSED → IN_PROGRESS` by `reopenIncident` (the
 * latter only within `REOPEN_WINDOW_MS`, checked in the service).
 */
export const INCIDENT_TRANSITIONS: Record<
  $Enums.IncidentStatus,
  readonly $Enums.IncidentStatus[]
> = {
  NEW: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["IN_PROGRESS"],
};

/** Throw `ForbiddenError` unless `from → to` is a declared transition. */
export function assertTransition(
  from: $Enums.IncidentStatus,
  to: $Enums.IncidentStatus,
): void {
  if (!INCIDENT_TRANSITIONS[from].includes(to)) {
    throw new ForbiddenError(`illegal incident transition: ${from} -> ${to}`);
  }
}

/** A `CLOSED` incident may be reopened only within 14 days of `closedAt`. */
export const REOPEN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
```

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/incident/state.ts src/server/modules/incident/__tests__/state.test.ts
git commit -m "feat: incident state machine

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Incident serializer (pure)

**Files:**
- Create: `src/server/modules/incident/serialize.ts`
- Test: `src/server/modules/incident/__tests__/serialize.test.ts`

**Interfaces:**
- Consumes: `serializePick` (`@/server/policy/serialize`), `Actor` (`@/server/policy/actor`), `isOverdue` (`./priority`).
- Produces:
  ```ts
  export const INCIDENT_GUEST_KEYS: readonly string[];
  //   ["id", "ref", "title", "description", "affectedService", "createdAt"]

  export function internalIncidentStatusLabel(s: $Enums.IncidentStatus): string;
  //   NEW "New" · ASSIGNED "Assigned" · IN_PROGRESS "In progress" · RESOLVED "Resolved" · CLOSED "Closed"

  export function guestIncidentStatusLabel(s: $Enums.IncidentStatus): string;
  //   NEW|ASSIGNED "Reported" · IN_PROGRESS "Investigating" · RESOLVED "Resolved" · CLOSED "Closed"  (spec §6)

  export function guestSlaLine(
    row: { dueAt: Date; status: $Enums.IncidentStatus; createdAt: Date; resolvedAt: Date | null },
    now: Date,
  ): string;
  //   resolved/closed → "Resolved in 2 days"; open & past due → "Response overdue";
  //   open & before due → "Response due in 3h"

  export type LinkedChangeView = { fix: "on_the_way" | "fixed" | null };

  export function serializeIncident(
    actor: Actor,
    row: Record<string, unknown>, // Incident + assignee?: {displayName} | null + client?: {name} | null
    ctx: { now: Date; linkedChanges: { kind: $Enums.LinkKind; status: $Enums.ChangeStatus }[] },
  ): Record<string, unknown>;
  ```
- **Internal serialization** = the row as-is, plus a freshly-derived `overdue` boolean (never the stored column). **Guest serialization** = `INCIDENT_GUEST_KEYS` + a `guestTransform` producing `status` (plain word), `slaLine`, `fix` (`"on_the_way"` when a `FIXES` link exists and its change is not `CLOSED`; `"fixed"` when `CLOSED`; else `null`), and `resolvedAt`. Guest output must contain **none** of: `impact`, `urgency`, `priority`, `assigneeId`, `dueAt`, `overdue`, `overdueNotifiedAt`, `reportedById`, `clientId`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import type { Actor } from "@/server/policy/actor";
import {
  INCIDENT_GUEST_KEYS,
  guestIncidentStatusLabel,
  guestSlaLine,
  serializeIncident,
} from "@/server/modules/incident/serialize";

const internal: Actor = { id: "u1", kind: "INTERNAL", hats: ["DEVELOPER"], clientId: null };
const guest: Actor = { id: "g1", kind: "GUEST", hats: [], clientId: "c1" };
const now = new Date("2026-09-06T12:00:00.000Z");

function row(over: Record<string, unknown> = {}) {
  return {
    id: "i1",
    ref: "INC-0001",
    title: "Exports failing",
    description: "500 on export",
    affectedService: "billing",
    impact: "HIGH",
    urgency: "HIGH",
    priority: "P1",
    status: "IN_PROGRESS",
    reportedById: "g1",
    clientId: "c1",
    assigneeId: "u1",
    dueAt: new Date("2026-09-06T10:00:00.000Z"), // 2h in the past → overdue
    overdue: false, // stale stored value — must be ignored
    overdueNotifiedAt: null,
    resolution: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date("2026-09-06T06:00:00.000Z"),
    assignee: { displayName: "Dev One" },
    client: { name: "Northwind" },
    ...over,
  };
}

test("internal reader gets the full row plus a freshly-derived overdue", () => {
  const out = serializeIncident(internal, row(), { now, linkedChanges: [] });
  expect(out.priority).toBe("P1");
  expect(out.assigneeId).toBe("u1");
  expect(out.overdue).toBe(true); // derived, not the stored false
});

test("guest reader gets only the allowlist plus the guest transform; no internal fields", () => {
  const out = serializeIncident(guest, row(), { now, linkedChanges: [] });
  const allowed = new Set([...INCIDENT_GUEST_KEYS, "status", "slaLine", "fix", "resolvedAt"]);
  for (const k of Object.keys(out)) expect(allowed.has(k)).toBe(true);
  for (const k of ["impact", "urgency", "priority", "assigneeId", "dueAt", "overdue", "reportedById", "clientId"]) {
    expect(out).not.toHaveProperty(k);
  }
  expect(out.status).toBe("Investigating");
  expect(out.slaLine).toBe("Response overdue");
  expect(out.fix).toBeNull();
});

test("guest fix line follows a FIXES link's change status", () => {
  const openFix = serializeIncident(guest, row(), {
    now,
    linkedChanges: [{ kind: "FIXES", status: "SCHEDULED" }],
  });
  expect(openFix.fix).toBe("on_the_way");
  const doneFix = serializeIncident(guest, row(), {
    now,
    linkedChanges: [{ kind: "FIXES", status: "CLOSED" }],
  });
  expect(doneFix.fix).toBe("fixed");
  const causedOnly = serializeIncident(guest, row(), {
    now,
    linkedChanges: [{ kind: "CAUSED_BY", status: "CLOSED" }],
  });
  expect(causedOnly.fix).toBeNull();
});

test("guestIncidentStatusLabel maps every state (spec section 6)", () => {
  expect(guestIncidentStatusLabel("NEW")).toBe("Reported");
  expect(guestIncidentStatusLabel("ASSIGNED")).toBe("Reported");
  expect(guestIncidentStatusLabel("IN_PROGRESS")).toBe("Investigating");
  expect(guestIncidentStatusLabel("RESOLVED")).toBe("Resolved");
  expect(guestIncidentStatusLabel("CLOSED")).toBe("Closed");
});

test("guestSlaLine: due, overdue, and resolved wording", () => {
  const base = { createdAt: new Date("2026-09-06T06:00:00.000Z") };
  expect(
    guestSlaLine({ ...base, dueAt: new Date("2026-09-06T15:00:00.000Z"), status: "IN_PROGRESS", resolvedAt: null }, now),
  ).toMatch(/due in/i);
  expect(
    guestSlaLine({ ...base, dueAt: new Date("2026-09-06T10:00:00.000Z"), status: "IN_PROGRESS", resolvedAt: null }, now),
  ).toMatch(/overdue/i);
  expect(
    guestSlaLine({ ...base, dueAt: new Date("2026-09-06T10:00:00.000Z"), status: "RESOLVED", resolvedAt: new Date("2026-09-08T06:00:00.000Z") }, now),
  ).toMatch(/resolved in/i);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `serialize.ts`**

Key points for the implementer:
- `serializePick(actor, row, { guestKeys: INCIDENT_GUEST_KEYS, guestTransform, internalOmit: [] })`.
- The internal branch needs `overdue` overridden — `serializePick`'s internal path returns the row minus `internalOmit`, so wrap: for an internal actor return `{ ...serializePick(...), overdue: isOverdue(row, ctx.now) }`. (Or add a tiny helper; do not leak the stored value.)
- `guestTransform(r)` returns:
  ```ts
  {
    status: guestIncidentStatusLabel(r.status),
    slaLine: guestSlaLine(r, ctx.now),
    fix: fixLineFrom(ctx.linkedChanges), // null | "on_the_way" | "fixed"
    resolvedAt: r.resolvedAt ?? null,
  }
  ```
- `fixLineFrom`: find a `kind === "FIXES"` link; none → `null`; its `status === "CLOSED"` → `"fixed"`; else `"on_the_way"`.
- `guestSlaLine` duration formatting: a small local `humanizeDuration(ms)` → "3h" / "2 days" / "45m". Keep it simple and covered by the test wording (`/due in/`, `/overdue/`, `/resolved in/`).

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/incident/serialize.ts src/server/modules/incident/__tests__/serialize.test.ts
git commit -m "feat: incident serializer with fresh overdue and guest allowlist

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Incident service — create, list, get, linked changes

**Files:**
- Create: `src/server/modules/incident/service.ts`, `src/lib/api/schemas/incidents.ts`, `src/app/api/incidents/route.ts`, `src/app/api/incidents/[id]/route.ts`
- Test: `src/server/modules/incident/__tests__/service.test.ts`, `src/app/api/incidents/__tests__/incidents.route.test.ts`

**Interfaces:**
- Consumes: `authorize`, `scopeToClient` / `assertVisibleToGuest`, `serializeIncident`, `nextRef` (`@/server/ids/ref`, prefix `"INC"`), `writeAudit`, `emitNotification`, `runInTransaction` / `PrismaTransaction`, `prisma`, `Actor` / `isInternal`, `auditActionLabel` / `guestAuditActionLabel`, `priorityFor` / `dueAtFrom` (`./priority`).
- Produces:
  ```ts
  export type CreateIncidentInternalInput = {
    kind: "INTERNAL";
    title: string; description: string; affectedService: string;
    impact: $Enums.Level; urgency: $Enums.Level;
  };
  export type CreateIncidentGuestInput = {
    kind: "GUEST";
    title: string; description: string; affectedService: string; affectingLevel: string;
  };
  export function createIncident(
    actor: Actor, tx: PrismaTransaction,
    input: CreateIncidentInternalInput | CreateIncidentGuestInput,
  ): Promise<{ id: string; ref: string }>;

  export function listIncidents(
    actor: Actor,
    filters: { status?: $Enums.IncidentStatus; priority?: $Enums.Priority; overdue?: boolean; mine?: boolean },
    client?: PrismaClient,
  ): Promise<Record<string, unknown>[]>;

  export function getIncidentForActor(
    actor: Actor, id: string, client?: PrismaClient,
  ): Promise<Record<string, unknown>>; // { ...serialized, activity, linkedChanges } — throws NotFoundError

  export function listLinkedChanges(
    incidentId: string, client?: PrismaClient,
  ): Promise<{ changeId: string; ref: string; kind: $Enums.LinkKind; status: $Enums.ChangeStatus }[]>;

  export function incidentClientId(id: string, client?: PrismaClient): Promise<string | null>;
  ```
- `INCIDENT_INCLUDE = { assignee: { select: { displayName: true } }, client: { select: { name: true } } } as const`.
- `mine` on the internal list filters `{ assigneeId: actor.id }` (spec §5 "mine"); for a guest `mine` is a no-op (their list is already fully scoped).
- `getIncidentForActor` assembles `activity` exactly like `getDemandForActor` (audit events → `auditActionLabel` / `guestAuditActionLabel` with a `flatMap` null-drop for guests) and attaches `linkedChanges` — **internal only** (`isInternal(actor) ? await listLinkedChanges(id, client) : undefined`); the guest's fix signal already rides the serializer's `fix` field.

- [ ] **Step 1: Write the failing tests** — `service.test.ts`

Mirror `src/server/modules/demand/__tests__/service.test.ts`'s seed helpers (`ctx`, `seedClientAndGuest`). Cases:

```ts
test("an internal user reports an incident: ref allocated, priority + dueAt derived, no client, audit written", async () => {
  // impact HIGH, urgency MEDIUM → priority P2 → dueAt = createdAt + 24h.
  // status NEW, reportedById = actor.id, clientId null, overdue false.
  // one incident.create audit event.
});

test("a guest reports an incident: impact/urgency forced MEDIUM, priority provisional P3, affectingLevel appended to description, clientId + reportedById server-side", async () => {
  // body has no impact/urgency. description ends with "How much it is affecting you: <text>".
  // every active internal user gets an ASSIGNED notification for the new incident.
});

test("guest list is scoped to the guest's own client; a cross-client get is a 404", async () => {
  // two clients, one incident each. guest one lists → only theirs.
  // getIncidentForActor(guestOne, otherIncidentId) rejects NotFoundError.
});

test("getIncidentForActor for an internal actor includes linkedChanges and the activity timeline; for a guest it omits linkedChanges and the timeline drops internal-only events", async () => {
  // seed an incident, write a couple of audit events (incident.create + incident.assigned),
  // guest activity contains "Problem reported" but not "Assigned".
});

test("listIncidents ?overdue filter and ?mine filter", async () => {
  // one incident past dueAt & open, one not. overdue:true returns only the first.
  // assign one to the actor; mine:true returns only that one.
});
```

`incidents.route.test.ts` — mirror `demands.route.test.ts` (`withRouteTestDb`, `asActor`). Cases: no session → 401; guest body with `impact` present is **ignored** (not a 400 — extra keys are stripped by the guest schema) and the created row is `MEDIUM`/`MEDIUM`/`P3`; internal body missing `impact` → 400 `{ error: "invalid" }`; valid internal create → 201 `{ id, ref }` with `ref` matching `/^INC-\d{4}$/`; `GET` guest list rows carry none of `impact` / `priority` / `assigneeId`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `incidents.ts` schemas**

```ts
import { z } from "zod";

const LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
const STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;

/** `POST /api/incidents` — internal reporter. */
export const createIncidentInternalBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  affectedService: z.string().trim().min(1).max(200),
  impact: z.enum(LEVELS),
  urgency: z.enum(LEVELS),
});
export type CreateIncidentInternalBody = z.infer<typeof createIncidentInternalBody>;

/** `POST /api/incidents` — guest reporter (spec §5). No impact/urgency. */
export const reportIncidentGuestBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  affectedService: z.string().trim().min(1).max(200),
  affectingLevel: z.string().trim().min(1).max(2000),
});
export type ReportIncidentGuestBody = z.infer<typeof reportIncidentGuestBody>;

export const listIncidentsQuery = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  overdue: z.coerce.boolean().optional(),
  mine: z.coerce.boolean().optional(),
});
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuery>;

export const categorizeIncidentBody = z.object({
  impact: z.enum(LEVELS),
  urgency: z.enum(LEVELS),
  reason: z.string().trim().min(1).max(2000).optional(),
});
export type CategorizeIncidentBody = z.infer<typeof categorizeIncidentBody>;

export const assignIncidentBody = z.object({
  assigneeId: z.string().trim().min(1),
});
export type AssignIncidentBody = z.infer<typeof assignIncidentBody>;

/** `POST /api/incidents/:id/transition`. `to` ∈ the forward set only —
 *  IN_PROGRESS / RESOLVED / CLOSED; reopen has its own endpoint. */
export const transitionIncidentBody = z.object({
  to: z.enum(["IN_PROGRESS", "RESOLVED", "CLOSED"]),
  resolution: z.string().trim().min(1).max(5000).optional(),
});
export type TransitionIncidentBody = z.infer<typeof transitionIncidentBody>;

export const reopenIncidentBody = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export type ReopenIncidentBody = z.infer<typeof reopenIncidentBody>;

/** Shared comment body — identical shape to demands (`commentBody`). */
export const incidentCommentBody = z.object({
  body: z.string().trim().min(1).max(5000),
  visibleToClient: z.boolean().optional(),
});
export type IncidentCommentBody = z.infer<typeof incidentCommentBody>;
```

- [ ] **Step 4: Implement `service.ts` — create / list / get / linked**

- `createIncident`: `authorize(actor, "incident.create", { type: "incident" })`. `const ref = await nextRef(tx, "INC")`. Branch on `input.kind`:
  - `INTERNAL`: `impact`/`urgency` from the body; `priority = priorityFor(impact, urgency)`.
  - `GUEST`: `impact = "MEDIUM"`, `urgency = "MEDIUM"`, `priority = "P3"`; `description = \`${input.description}\n\nHow much it is affecting you: ${input.affectingLevel}\``.
  - `const createdAt = new Date(); const dueAt = dueAtFrom(priority, createdAt);`
  - `tx.incident.create({ data: { ref, title, description, affectedService, impact, urgency, priority, status: "NEW", reportedById: actor.id, clientId: isInternal(actor) ? null : actor.clientId, dueAt, overdue: false, createdAt } })` — pass `createdAt` explicitly so `dueAt` and the stored row agree.
  - `writeAudit(tx, { actorId: actor.id, action: "incident.create", subjectType: "Incident", subjectId: incident.id, payload: { priority, byGuest: !isInternal(actor) } })`.
  - if `!isInternal(actor)`: `emitNotification(tx, { recipients: { audience: "ALL_INTERNAL" }, kind: "ASSIGNED", subjectType: "Incident", subjectId: incident.id, summary: \`New client incident: ${title}\`, excludeActorId: actor.id })`.
  - return `{ id, ref }`.
- `listIncidents`: `where` from `scopeToClient(actor)` + `status` + `priority` + (`overdue` → `{ overdue: true }` — the stored column, kept honest by the sweep) + (`mine && isInternal(actor)` → `{ assigneeId: actor.id }`). `findMany({ where, include: INCIDENT_INCLUDE, orderBy: { createdAt: "desc" } })`. Map through `serializeIncident(actor, row, { now: new Date(), linkedChanges: [] })` — the list view does not need per-row linked changes (the card shows no fix line); pass `[]`.
- `getIncidentForActor`: `findUnique({ where: { id }, include: INCIDENT_INCLUDE })`; `if (!row) throw new NotFoundError("not found")`; `assertVisibleToGuest(actor, row)`; `authorize(actor, "incident.view", { type: "incident", id, clientId: row.clientId })`. Then:
  - `const linked = await listLinkedChanges(id, client);`
  - `const serialized = serializeIncident(actor, row, { now: new Date(), linkedChanges: linked });`
  - assemble `activity` from `client.auditEvent.findMany({ where: { subjectType: "Incident", subjectId: id }, orderBy: { at: "asc" }, select: { action: true, at: true } })` exactly as `getDemandForActor` does.
  - return `{ ...serialized, activity, ...(isInternal(actor) ? { linkedChanges: linked } : {}) }`.
- `listLinkedChanges`: `client.changeIncidentLink.findMany({ where: { incidentId }, include: { change: { select: { ref: true, status: true } } } })` → map to `{ changeId, ref, kind, status }`. Safe now — `Change` / `ChangeIncidentLink` exist and are empty until plan-03.
- `incidentClientId`: narrow `select: { clientId: true }` read (mirror `demandClientId`).

- [ ] **Step 5: Implement the routes**

`src/app/api/incidents/route.ts`:
```ts
import { NextResponse } from "next/server";
import {
  createIncidentInternalBody,
  listIncidentsQuery,
  reportIncidentGuestBody,
} from "@/lib/api/schemas/incidents";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { createIncident, listIncidents } from "@/server/modules/incident/service";
import { isInternal } from "@/server/policy/actor";

export const POST = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  const raw = await req.json().catch(() => null);
  const input = isInternal(actor)
    ? { kind: "INTERNAL" as const, ...createIncidentInternalBody.parse(raw) }
    : { kind: "GUEST" as const, ...reportIncidentGuestBody.parse(raw) };
  const out = await runInTransaction((tx) => createIncident(actor, tx, input));
  return NextResponse.json(out, { status: 201 });
});

export const GET = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  const filters = listIncidentsQuery.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  return NextResponse.json({ incidents: await listIncidents(actor, filters) });
});
```

`src/app/api/incidents/[id]/route.ts` — `GET` only, dynamic-segment form:
```ts
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    return NextResponse.json(await getIncidentForActor(actor, id));
  })(req);
}
```

- [ ] **Step 6: Run tests, verify pass. Full gate.**

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/incident/ src/lib/api/schemas/incidents.ts src/app/api/incidents/ src/server/modules/incident/__tests__/
git commit -m "feat: incident create/list/get — service, schemas, routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Incident categorise + assign

**Files:**
- Create: `src/app/api/incidents/[id]/categorize/route.ts`, `src/app/api/incidents/[id]/assign/route.ts`
- Modify: `src/server/modules/incident/service.ts`
- Test: extend `src/server/modules/incident/__tests__/service.test.ts`, `src/app/api/incidents/__tests__/categorize-assign.route.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function categorizeIncident(
    actor: Actor, tx: PrismaTransaction, id: string,
    input: { impact: $Enums.Level; urgency: $Enums.Level; reason?: string },
  ): Promise<void>;
  export function assignIncident(
    actor: Actor, tx: PrismaTransaction, id: string, input: { assigneeId: string },
  ): Promise<void>;
  ```
- Consumes: `requireInternal` for the load-order gate is **not** needed — `authorize(actor, "incident.categorize" | "incident.assign", …)` already requires the `DEVELOPER` hat (`incident.rule.ts`). Gate before the load, like the demand service.

- [ ] **Step 1: Write the failing tests** (extend `service.test.ts`)

```ts
test("categorize while NEW: recomputes priority and dueAt, incident.categorized audited", async () => {
  // seed NEW incident, createdAt fixed. categorize HIGH/HIGH → priority P1, dueAt = createdAt + 4h.
  // payload { impact, urgency, priority, dueAt }.
});

test("categorize after work started requires a reason; the reason is audited and added as an internal comment; dueAt is NOT recomputed", async () => {
  // move an incident to IN_PROGRESS (assign + transition). categorize with no reason → ForbiddenError.
  // categorize with a reason → succeeds; a Comment row with visibleToClient=false exists; dueAt unchanged.
});

test("assign to an internal user: NEW → ASSIGNED, assignee notified, incident.assigned audited", async () => {
  // one ASSIGNED notification to the assignee; status ASSIGNED.
});

test("assigning a guest user is rejected (ForbiddenError)", async () => {
  // create a GUEST user, assignIncident with their id → ForbiddenError.
});

test("assigning a RESOLVED incident is rejected", async () => {
  // drive to RESOLVED, assignIncident → ForbiddenError.
});

test("re-assign while ASSIGNED keeps the status and re-notifies the new assignee", async () => {});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `categorizeIncident`**

```
authorize(actor, "incident.categorize", { type: "incident", id });
const row = await tx.incident.findUnique({ where: { id } });  // NotFoundError if null
const locked = row.status !== "NEW" && row.status !== "ASSIGNED";
if (locked && !input.reason?.trim()) {
  throw new ForbiddenError("categorisation is locked once work has started — a reason is required");
}
const priority = priorityFor(input.impact, input.urgency);
const data: Prisma.IncidentUpdateInput-shaped object = { impact: input.impact, urgency: input.urgency, priority };
if (!locked) data.dueAt = dueAtFrom(priority, row.createdAt);   // clock only moves pre-work
await tx.incident.update({ where: { id }, data });
await writeAudit(tx, { actorId: actor.id, action: "incident.categorized", subjectType: "Incident", subjectId: id,
  payload: { impact: input.impact, urgency: input.urgency, priority, dueAt: (data.dueAt ?? row.dueAt), ...(input.reason ? { reason: input.reason.trim() } : {}) } });
if (locked && input.reason?.trim()) {
  await addComment(tx, { actor, subject: { type: "Incident", id, clientId: row.clientId }, body: `Re-categorised: ${input.reason.trim()}`, visibleToClient: false });
}
```
(Import `addComment` from `@/server/modules/comment`. It runs `requireOwnClientOr404` internally — an internal actor passes.)

- [ ] **Step 4: Implement `assignIncident`**

```
authorize(actor, "incident.assign", { type: "incident", id });
const row = await tx.incident.findUnique({ where: { id } });  // NotFoundError if null
if (row.status === "RESOLVED" || row.status === "CLOSED") {
  throw new ForbiddenError("cannot assign a resolved or closed incident");
}
const assignee = await tx.user.findUnique({ where: { id: input.assigneeId }, select: { kind: true, isActive: true } });
if (!assignee || assignee.kind !== "INTERNAL" || !assignee.isActive) {
  throw new ForbiddenError("assignee must be an active internal user");
}
const nextStatus = row.status === "NEW" ? "ASSIGNED" : row.status;
if (nextStatus !== row.status) assertTransition(row.status, nextStatus);
await tx.incident.update({ where: { id }, data: { assigneeId: input.assigneeId, status: nextStatus } });
await writeAudit(tx, { actorId: actor.id, action: "incident.assigned", subjectType: "Incident", subjectId: id, payload: { assigneeId: input.assigneeId, ...(nextStatus !== row.status ? { from: row.status, to: nextStatus } : {}) } });
await emitNotification(tx, { recipients: { userIds: [input.assigneeId] }, kind: "ASSIGNED", subjectType: "Incident", subjectId: id, summary: `You were assigned ${row.ref}: ${row.title}`, excludeActorId: actor.id });
```

- [ ] **Step 5: Implement the routes** — `PATCH` categorize, `POST` assign; dynamic-segment form; `runInTransaction`; `NextResponse.json({ ok: true })`.

- [ ] **Step 6: Run tests, verify pass. Full gate.**

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/incident/service.ts src/app/api/incidents/ src/server/modules/incident/__tests__/
git commit -m "feat: incident categorise and assign

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Incident transition, resolve, close, reopen + overdue sweep

**Files:**
- Create: `src/app/api/incidents/[id]/transition/route.ts`, `src/app/api/incidents/[id]/reopen/route.ts`, `src/server/modules/incident/sweep.ts`
- Modify: `src/server/modules/incident/service.ts`, `src/server/bootstrap.ts`, `src/server/audit/labels.ts`, `src/server/modules/notify/templates/index.ts`
- Test: extend `service.test.ts`, `src/server/modules/incident/__tests__/sweep.test.ts`, `src/app/api/incidents/__tests__/transition.route.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function transitionIncident(
    actor: Actor, tx: PrismaTransaction, id: string,
    input: { to: "IN_PROGRESS" | "RESOLVED" | "CLOSED"; resolution?: string },
  ): Promise<void>;
  export function reopenIncident(
    actor: Actor, tx: PrismaTransaction, id: string, input: { reason: string },
  ): Promise<void>;

  // sweep.ts
  export function sweepOverdueIncidents(deps?: {
    now?: () => Date;
    db?: PrismaClient; // defaults to the app singleton; tests pass db()
  }): Promise<{ flagged: number; cleared: number }>;
  export function startOverdueSweeper(): void; // globalThis-guarded setInterval, OVERDUE_POLL_MS (default 60000)
  ```

- [ ] **Step 1: Write the failing tests** (extend `service.test.ts` + new `sweep.test.ts`)

`service.test.ts`:
```ts
test("ASSIGNED → IN_PROGRESS → RESOLVED (with resolution) → CLOSED, each transition audited, reporter notified", async () => {
  // incident.transitioned {from,to} on the IN_PROGRESS step; incident.resolved {resolution}; incident.closed.
  // a STATUS_CHANGED notification to the reporter on each; a guest reporter also gets an EmailOutbox row (template incident_status).
});

test("RESOLVED without resolution text is rejected", async () => {
  // transitionIncident(to: RESOLVED) with no resolution → ForbiddenError.
});

test("CLOSED only from RESOLVED", async () => {
  // transition IN_PROGRESS → CLOSED → ForbiddenError.
});

test("reopen from RESOLVED → IN_PROGRESS any time; clears resolvedAt/closedAt; incident.reopened audited", async () => {});

test("reopen from CLOSED within 14 days works; past 14 days → ForbiddenError", async () => {
  // set closedAt to 15 days ago via a direct db().incident.update, then reopenIncident → ForbiddenError('reopen window').
});

test("a guest cannot transition, categorize, assign, or reopen (ForbiddenError / 404)", async () => {});
```

`sweep.test.ts`:
```ts
const db = withTestDb();

test("sweepOverdueIncidents flags a past-due open incident once, emits one OVERDUE notification + one incident.overdue audit, stamps overdueNotifiedAt", async () => {
  // seed an incident with dueAt in the past, status IN_PROGRESS, overdue=false, overdueNotifiedAt=null.
  // first run: flagged 1; incident.overdue == true; overdueNotifiedAt set; ALL_INTERNAL (+ assignee) notified; one audit event actorId null.
  // second run: flagged 0; still exactly one notification and one audit event.
});

test("sweepOverdueIncidents clears the stored overdue flag for an incident that has since been resolved", async () => {
  // overdue=true stored, status RESOLVED → run → overdue=false, cleared 1, no new notification.
});

test("a not-yet-due incident is untouched", async () => {});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `transitionIncident`**

```
authorize(actor, "incident.transition", { type: "incident", id });
const row = await tx.incident.findUnique({ where: { id } });  // NotFoundError if null
assertTransition(row.status, input.to);
const now = new Date();
const data: {...} = { status: input.to };
let action: string;
let payload: Record<string, unknown>;
if (input.to === "RESOLVED") {
  const resolution = input.resolution?.trim();
  if (!resolution) throw new ForbiddenError("a resolution is required to resolve an incident");
  data.resolution = resolution; data.resolvedAt = now;
  action = "incident.resolved"; payload = { resolution };
} else if (input.to === "CLOSED") {
  data.closedAt = now;
  action = "incident.closed"; payload = {};
} else {
  action = "incident.transitioned"; payload = { from: row.status, to: input.to };
}
await tx.incident.update({ where: { id }, data });
await writeAudit(tx, { actorId: actor.id, action, subjectType: "Incident", subjectId: id, payload });
await notifyReporterAndAssignee(tx, { row, action, guestStatus: guestIncidentStatusLabel(input.to) });
```

`notifyReporterAndAssignee` (a local helper): `STATUS_CHANGED` to `row.reportedById` (always) and `row.assigneeId` (when set and ≠ actor); when the reporter is a `GUEST`, attach `email: { template: "incident_status", payload: { ref: row.ref, status: guestStatus } }` on the reporter's notification. Resolve the reporter's `kind` with a narrow `tx.user.findUnique`.

- [ ] **Step 4: Implement `reopenIncident`**

```
authorize(actor, "incident.transition", { type: "incident", id });
const row = await tx.incident.findUnique({ where: { id } });  // NotFoundError if null
assertTransition(row.status, "IN_PROGRESS");   // legal only from RESOLVED or CLOSED
if (row.status === "CLOSED") {
  const closedMs = row.closedAt?.getTime() ?? 0;
  if (Date.now() - closedMs > REOPEN_WINDOW_MS) {
    throw new ForbiddenError("the reopen window has closed");
  }
}
await tx.incident.update({ where: { id }, data: { status: "IN_PROGRESS", resolvedAt: null, closedAt: null } });
await writeAudit(tx, { actorId: actor.id, action: "incident.reopened", subjectType: "Incident", subjectId: id, payload: { from: row.status, reason: input.reason.trim() } });
await notifyReporterAndAssignee(tx, { row, action: "incident.reopened", guestStatus: guestIncidentStatusLabel("IN_PROGRESS") });
```

- [ ] **Step 5: Implement `sweep.ts`**

```ts
import { prisma } from "@/server/db/client";
import type { PrismaClient } from "@prisma/client";
import { runInTransaction } from "@/server/db/tx";
import { writeAudit } from "@/server/audit/write";
import { emitNotification } from "@/server/modules/notify/emit";
import { runWithContext } from "@/server/context";
import { logger } from "@/server/log";

const OVERDUE_POLL_MS = Number(process.env.OVERDUE_POLL_MS ?? 60_000);

export async function sweepOverdueIncidents(deps?: {
  now?: () => Date;
  db?: PrismaClient;
}): Promise<{ flagged: number; cleared: number }> {
  const db = deps?.db ?? prisma;
  const now = deps?.now?.() ?? new Date();

  // 1. Clear the stored flag for anything that is no longer overdue-eligible.
  const cleared = await db.incident.updateMany({
    where: { overdue: true, status: { in: ["RESOLVED", "CLOSED"] } },
    data: { overdue: false },
  });

  // 2. Flag + notify the newly-overdue. `overdueNotifiedAt IS NULL` makes it
  //    fire exactly once per incident (spec §3).
  const due = await db.incident.findMany({
    where: {
      status: { notIn: ["RESOLVED", "CLOSED"] },
      dueAt: { lt: now },
      overdueNotifiedAt: null,
    },
    select: { id: true, ref: true, title: true, assigneeId: true },
  });

  for (const inc of due) {
    // Each incident in its own tx + request context (writeAudit needs a
    // requestId). A system action → actorId null.
    await runWithContext({ requestId: `sweep-${inc.id}`, actorId: null }, () =>
      runInTransaction(async (tx) => {
        await tx.incident.update({
          where: { id: inc.id },
          data: { overdue: true, overdueNotifiedAt: now },
        });
        await writeAudit(tx, {
          actorId: null,
          action: "incident.overdue",
          subjectType: "Incident",
          subjectId: inc.id,
          payload: {},
        });
        await emitNotification(tx, {
          recipients: inc.assigneeId
            ? { userIds: [inc.assigneeId] }
            : { audience: "ALL_INTERNAL" },
          kind: "OVERDUE",
          subjectType: "Incident",
          subjectId: inc.id,
          summary: `${inc.ref} is overdue: ${inc.title}`,
        });
        // Also make sure every internal user hears about it, once.
        await emitNotification(tx, {
          recipients: { audience: "ALL_INTERNAL" },
          kind: "OVERDUE",
          subjectType: "Incident",
          subjectId: inc.id,
          summary: `${inc.ref} is overdue: ${inc.title}`,
        });
      }),
    );
  }

  return { flagged: due.length, cleared: cleared.count };
}
```
**Implementer note:** the double `emitNotification` above would double-notify the assignee. Simplify to **one** call: `recipients: { audience: "ALL_INTERNAL" }` (that covers the assignee, who is internal), and if a stricter "assignee always, even if somehow not internal" guarantee is wanted, merge ids. Pick the single-call version; the test asserts "one OVERDUE notification per internal user".

`startOverdueSweeper()` mirrors `startOutboxWorker()` in `src/server/modules/notify/worker.ts` — a `globalThis` flag guard, `setInterval(() => { sweepOverdueIncidents().catch((e) => logger.error({ err: e }, "overdue sweep failed")); }, OVERDUE_POLL_MS)`, one `logger.info("overdue sweeper started")`.

- [ ] **Step 6: Wire `startOverdueSweeper()` into `src/server/bootstrap.ts`** next to `startOutboxWorker()`.

- [ ] **Step 7: Extend `src/server/audit/labels.ts`**

Add to `AUDIT_ACTION_LABELS`:
```ts
"incident.create": "Incident reported",
"incident.categorized": "Categorised",
"incident.assigned": "Assigned",
"incident.transitioned": "Status changed",
"incident.resolved": "Resolved",
"incident.closed": "Closed",
"incident.reopened": "Reopened",
"incident.overdue": "Marked overdue",
```
Add to `guestAuditActionLabel`'s `GUEST_VISIBLE`:
```ts
"incident.create": "Problem reported",
"incident.transitioned": "Status updated",
"incident.resolved": "Marked resolved",
"incident.closed": "Closed",
```

- [ ] **Step 8: Register the `incident_status` email template** in `src/server/modules/notify/templates/index.ts` — a pure `(payload: { ref, status }) => { subject, text, html }`, guest-safe (plain-word `status` only, a `/portal/incidents` deep link from `APP_URL`). Mirror `demand_decided`.

- [ ] **Step 9: Implement the routes** — `POST` transition, `POST` reopen; dynamic-segment form.

- [ ] **Step 10: Run tests, verify pass. Full gate.**

- [ ] **Step 11: Commit**

```bash
git add src/server/modules/incident/ src/app/api/incidents/ src/server/bootstrap.ts src/server/audit/labels.ts src/server/modules/notify/templates/
git commit -m "feat: incident work transitions, reopen, and the once-only overdue sweep

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Incident comments route

**Files:**
- Create: `src/app/api/incidents/[id]/comments/route.ts`
- Test: `src/app/api/incidents/__tests__/comments.route.test.ts`

**This is a near-exact copy of `src/app/api/demands/[id]/comments/route.ts`.** Swap:
- `commentBody` → `incidentCommentBody` (`@/lib/api/schemas/incidents`)
- `getDemandForActor` → `getIncidentForActor`, `demandClientId` → `incidentClientId`
- `{ type: "Demand", … }` → `{ type: "Incident", … }` in both the `CommentSubject` and the `authorize(actor, "comment.create", { type: "incident", id, clientId })` call
- doc comment references plan-01 Task 6 → plan-02 Task 7

The comment module (`addComment` / `listComments`) already supports `{ type: "Incident"; id; clientId }` (CONTRACTS §4). No module change.

- [ ] **Step 1: Write the failing test** — mirror `src/app/api/demands/__tests__/comments.route.test.ts`. Cases: internal comment with `visibleToClient: false` is hidden from the guest list; a guest comment is forced `visibleToClient: true`; a guest on another client's incident → 404; the POST re-lists and returns `{ comments }` with `serializeComment` applied (internal author shows as "Keel team" to the guest).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement the route** (copy + swap as above).

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/app/api/incidents/[id]/comments/ src/app/api/incidents/__tests__/comments.route.test.ts
git commit -m "feat: incident comments route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Incident register (`/incidents`)

**Files:**
- Create: `src/app/(internal)/incidents/page.tsx`, `IncidentRegister.tsx`, `IncidentCard.tsx`, `incidents.module.css`
- Modify: `src/app/(internal)/AppShellChrome.tsx` (append the `incidents` `NavItem`)
- Test: `src/app/(internal)/incidents/__tests__/register.test.tsx`, and extend `src/app/(internal)/__tests__/nav.test.ts` if it enumerates the nav

**Interfaces:**
- Consumes: `getCurrentActor` / `whoami` (`@/server/auth/current`), `listIncidents`, `listIncidentsQuery`, `Pill` / `PriorityTag` (`@/components/Pill`).
- `page.tsx` mirrors `src/app/(internal)/demands/page.tsx`: resolve the actor (RSC-safe `getCurrentActor`), `redirect("/login")` if none, parse `?status/?priority/?overdue/?mine` with `listIncidentsQuery`, `const rows = await listIncidents(actor, filters)`, render `<IncidentRegister initialRows={rows} initialFilters={…} viewer={{ id, kind, hats }} />`.

**UI (spec §9.1):** a **card list** (not `DataTable`). Each `IncidentCard`:
- a left severity rail — `--crit` for P1/P2, `--warn` for P3, `--muted` for P4 (tokens only)
- `ref`, title, `<PriorityTag priority={…} />`, affected service, relative age
- a `dueAt` line: "due in 3h" / an `OVERDUE` badge (`<Pill tone="crit" dot>OVERDUE</Pill>`) when `row.overdue`
- assignee display name (or "Unassigned")
- the whole card is a `<button>` that opens `<IncidentDrawer id={openId} …>` (mirror `DemandRegister`'s `openId` state)

Filters: status chips, priority chips, an "Overdue only" toggle, a "Mine" toggle — each updates local state for instant filtering **and** `router.push`es the query (mirror `DemandRegister.pushQuery`).

- [ ] **Step 1: Write the failing test** — `register.test.tsx` (`/** @vitest-environment jsdom */`). Render `<IncidentRegister>` with a couple of fixture rows (one overdue P1, one P4 not overdue). Assert: both refs render; the overdue card shows an `OVERDUE` badge; toggling "Overdue only" hides the P4 card; clicking a card mounts the drawer (mock `apiFetch` for the drawer GET). Mock `next/navigation`'s `useRouter`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `IncidentCard`, `IncidentRegister`, `page.tsx`, the CSS, and the nav item.** The nav item:
```ts
{
  key: "incidents",
  label: "Incidents",
  href: "/incidents",
  icon: (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>),
}
```

- [ ] **Step 4: Run, verify pass. Full gate** (build compiles the new route).

- [ ] **Step 5: Commit**

```bash
git add src/app/(internal)/incidents/ src/app/(internal)/AppShellChrome.tsx src/app/(internal)/__tests__/
git commit -m "feat: incident register and Incidents nav

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Incident drawer

**Files:**
- Create: `src/app/(internal)/incidents/IncidentDrawer.tsx`, `IncidentDrawer.module.css`
- Test: `src/app/(internal)/incidents/__tests__/drawer.test.tsx`

**This mirrors `src/app/(internal)/demands/DemandDrawer.tsx` closely.** `viewer` prop `{ id, kind, hats }`. On `open` it `apiFetch`es `GET /api/incidents/:id` and `GET /api/incidents/:id/comments`. Every write goes through `apiFetch`; after a successful write both GETs re-run.

Panels (spec §9.2):
- **Header** — `ref`, title, `<PriorityTag>`, a status `<Pill>` (`internalIncidentStatusLabel`).
- **Impact** — `description` + affected service (read-only).
- **Categorisation** — `impact` / `urgency` `<select>`s; a live priority preview computed client-side with a local copy of the matrix (or better: a tiny `priorityFor` re-exported to a `"use client"`-safe module — `src/server/modules/incident/priority.ts` is pure and imports only a type, so it is safe to import into a client component; confirm the eslint boundary allows `src/server/modules/incident/priority.ts` from `src/app/**` — if not, inline a 6-line `previewPriority`). A "Save categorisation" button → `PATCH /api/incidents/:id/categorize`. When the incident is `IN_PROGRESS`+ show a required "reason" textarea (the server enforces it too). Gate the whole panel on `viewer.hats.includes("DEVELOPER")`.
- **Assignment** — an assignee `<select>` of internal users. **The list of internal users** is not currently exposed by any endpoint. Ship a minimal `GET /api/users?kind=INTERNAL` in this task (action: a new `requireInternal` check — no new policy action needed; wrap in `withRequest`, return `{ users: [{ id, displayName }] }` for active internal users only). Add its schema + a route test. "Assign" → `POST /api/incidents/:id/assign`.
- **Work** — transition buttons following the state machine (`ASSIGNED`→Start, `IN_PROGRESS`→Resolve, `RESOLVED`→Close, plus a Reopen button on `RESOLVED`/`CLOSED`). "Resolve" reveals a required resolution textarea → `POST /api/incidents/:id/transition { to: "RESOLVED", resolution }`. "Reopen" reveals a required reason textarea → `POST /api/incidents/:id/reopen`. Gate on `viewer.hats.includes("DEVELOPER")`. Disable a button whose transition the server would reject (mirror `DemandDrawer`'s `canSubmitDecision` gating).
- **SLA** — `dueAt` and either "time remaining" or "overdue by <duration>", from the serialized `overdue` + `dueAt`.
- **Linked change** — from `demand.linkedChanges` (internal serialization only); render "Caused by CHG-… (status)" / "Fixed by CHG-… (status)". Empty until plan-03 seeds any — that is fine.
- **Timeline** — `<Timeline items={incident.activity ?? []} />`.
- **Comments** — identical to `DemandDrawer`'s Comments panel (the "visible to client" checkbox for internal authors, `POST /api/incidents/:id/comments`, re-fetch).

- [ ] **Step 1: Write the failing test** — `drawer.test.tsx` (`/** @vitest-environment jsdom */`, mock `@/lib/api/client`'s `apiFetch` like `demands/__tests__/drawer.test.tsx`). Cases:
  - opens with ref / title / priority tag / status pill
  - a `DEVELOPER` viewer sees the categorisation selectors; a hat-less viewer sees them read-only
  - changing impact/urgency updates the live priority preview
  - "Resolve" is disabled until a resolution is typed; submitting calls `POST …/transition` with `{ to: "RESOLVED", resolution }` then re-fetches
  - posting a comment calls `POST …/comments` and shows it
  - the assignee `<select>` is populated from `GET /api/users?kind=INTERNAL`

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `GET /api/users?kind=INTERNAL`** (`src/app/api/users/route.ts` + `src/lib/api/schemas/users.ts` + a route test), then `IncidentDrawer` + CSS.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/app/(internal)/incidents/ src/app/api/users/ src/lib/api/schemas/users.ts src/app/api/users/__tests__/
git commit -m "feat: incident drawer with categorise/assign/work actions and the internal-users endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Guest portal incident pages

**Files:**
- Create: `src/app/portal/(guest)/incidents/page.tsx`, `[id]/page.tsx`, `new/page.tsx`, `PortalIncidentList.tsx`, `PortalIncidentDetail.tsx`, `PortalIncidentForm.tsx`, `portal-incidents.module.css`
- Modify (maybe): `src/app/portal/(guest)/demands/CommentThread.tsx` — if it hard-codes `/api/demands/:id/comments`, lift the base to a `basePath` prop and pass `/api/incidents/${id}` from the incident detail; otherwise reuse as-is.
- Modify: `src/app/portal/(guest)/layout.tsx` or its nav — add "My incidents" + "Report a problem" links (the portal nav; keep it minimal, plan-04 unifies it).
- Test: `src/app/portal/(guest)/incidents/__tests__/portal.test.tsx`

**Mirror `src/app/portal/(guest)/demands/**` exactly.**

- `incidents/page.tsx` — `getCurrentActor()` guard, `const rows = await listIncidents(actor, {})`, render `<PortalIncidentList rows={rows} />`. Cards (spec §4.3): title, status word, affected software, the `slaLine`, an unread-comment dot (defer the dot — plan-04 wires notifications; render without it or with a static placeholder).
- `incidents/[id]/page.tsx` — mirror `demands/[id]/page.tsx`: `getIncidentForActor` in a `try/catch` → `notFound()` on `NotFoundError`. Render `<PortalIncidentDetail incident={incident} />`.
- `PortalIncidentDetail` — header (ref, title, status word); "Where it is" milestone line from `status`; the `slaLine`; the `fix` line ("A fix is on the way" / "Fixed" when `fix === "fixed"`); "Details you gave" (title + description, read-only); "Conversation" (the reused `CommentThread`). It receives only guest-serialized strings — assert in the test that the DOM contains no internal vocabulary (no `assigneeId`, no `IN_PROGRESS`, no priority `P1`).
- `new/page.tsx` + `PortalIncidentForm` — fields: title, description, which software (`affectedService`), "how much is it affecting you" (`affectingLevel`). `apiFetch("/api/incidents", { method: "POST", body: {...} })` → on 201 `router.push("/portal/incidents")`. Client-side required-field checks mirroring `reportIncidentGuestBody`; the server is authoritative.

- [ ] **Step 1: Write the failing test** — `portal.test.tsx`. Cases:
  - `PortalIncidentList` renders each incident's title + status word + `slaLine`
  - `PortalIncidentDetail` for an `IN_PROGRESS` incident shows "Investigating", the SLA line, no internal fields in the DOM
  - `PortalIncidentDetail` with `fix: "on_the_way"` shows "A fix is on the way"
  - `PortalIncidentForm` posts to `/api/incidents` with the four guest fields and routes to `/portal/incidents` on success

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement the pages + components + CSS; adjust `CommentThread` if needed.**

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/app/portal/(guest)/incidents/ src/app/portal/(guest)/demands/CommentThread.tsx src/app/portal/(guest)/layout.tsx
git commit -m "feat: guest portal incident list, detail, and report form

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: Seed demo incidents

**Files:**
- Modify: `prisma/seed.ts`
- Test: none new (the seed is exercised by the integration test in Task 12 and by `pnpm seed` in review)

**Add `seedDemoIncidents()`**, called from `main()` inside the existing `if (process.env.NODE_ENV !== "production")` block, after `seedDemoDemands()`. Compose with the existing seed — look up "Northwind Traders" and the existing `guest@northwind.example` / `ceo@keel.local` / `cto@keel.local` users by their unique keys; do not create duplicates. `upsert` every row on a unique key. Fixed refs `INC-9001..9004` (far above the `Counter` range):

- `INC-9001` — `NEW`, guest-reported, `impact/urgency` `MEDIUM/MEDIUM`, `priority` `P3`, `dueAt` = now + 72h, `overdue` false. "Login page slow after the last release."
- `INC-9002` — `ASSIGNED` to `cto`, categorised `HIGH/MEDIUM` → `P2`, `dueAt` now + 24h. "Invoices export as an empty file."
- `INC-9003` — `IN_PROGRESS`, assigned to `cto`, `HIGH/HIGH` → `P1`, `dueAt` **in the past** (now − 2h), `overdue` **true**, `overdueNotifiedAt` set (so the sweep does not re-notify a demo row). "Portal is returning 500 for all users."
- `INC-9004` — `RESOLVED`, assigned to `cto`, `resolution` set, `resolvedAt` set, `P3`. "Typo in the welcome email." (Gives the portal a "Resolved in …" line.)

All `reportedById` = the guest, `clientId` = Northwind. Written directly (no audit / notification — display fixtures, like `seedDemoDemands`). Update the `console.log` summary line.

- [ ] **Step 1** — implement `seedDemoIncidents()`.
- [ ] **Step 2** — `pnpm seed` against the dev DB; verify the four rows and that `pnpm typecheck` + `pnpm lint` pass.
- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "chore: seed demo incidents across the lifecycle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: Lifecycle integration test + CONTRACTS amendment

**Files:**
- Create: `src/server/modules/incident/__tests__/lifecycle.integration.test.ts`
- Modify: `CONTRACTS.md` (add the plan-02 amendment entry), `plans/plan-02-incident.md` (tick the task checkboxes as they land)

- [ ] **Step 1: Write the integration test** — one `test` that walks the whole spec §11 definition of done against the disposable DB, all in `db().$transaction` / `runWithContext`:
  1. seed a client + a guest + an internal `DEVELOPER`+`TECHNICAL_APPROVER` user (`ceo`/`cto` shape)
  2. guest `createIncident` (GUEST input) → status `NEW`, `priority` `P3`, `affectingLevel` in the description, one `incident.create` audit, an `ASSIGNED` notification to the internal user
  3. internal `categorizeIncident` `HIGH/HIGH` → `priority` `P1`, `dueAt` recomputed, `incident.categorized` audit
  4. internal `assignIncident` to themselves → `ASSIGNED`, assignee notification
  5. `transitionIncident` → `IN_PROGRESS` → `incident.transitioned`
  6. `transitionIncident` → `RESOLVED` with `resolution` → `incident.resolved`, `resolvedAt` set, a `STATUS_CHANGED` notification + an `EmailOutbox` row (guest reporter, template `incident_status`)
  7. `transitionIncident` → `CLOSED` → `incident.closed`
  8. `getIncidentForActor(guestActor, id)` → guest-serialized: `status` `"Closed"`, a "Resolved in …" `slaLine`, **no** `impact` / `priority` / `assigneeId` keys, and the `activity` timeline contains "Problem reported" / "Marked resolved" / "Closed" but **not** "Assigned" / "Categorised"
  9. `sweepOverdueIncidents()` at a `now` after a fresh past-due incident's `dueAt` → flags it once; a second call flags nothing

- [ ] **Step 2: Run it, verify it passes.** Full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

- [ ] **Step 3: Add the CONTRACTS.md amendment** under "Phase 1 amendments":

> - **plan-02** — `src/server/modules/incident/` ships the incident lifecycle. `serializeIncident(actor, row, { now, linkedChanges })` (`serialize.ts`) — allowlist guest view (`INCIDENT_GUEST_KEYS`), `overdue` always derived fresh (never the stored column), guest `status` / `slaLine` / `fix`. `priorityFor` / `dueAtFrom` / `isOverdue` (`priority.ts`, pure — safe to import from a client component, type-only Prisma dep). `INCIDENT_TRANSITIONS` / `assertTransition` / `REOPEN_WINDOW_MS` (`state.ts`). Service: `createIncident` (actor-selected input union), `listIncidents`, `getIncidentForActor` (+ `activity`, + `linkedChanges` for internal), `listLinkedChanges`, `incidentClientId`, `categorizeIncident`, `assignIncident`, `transitionIncident`, `reopenIncident`. `sweepOverdueIncidents` + `startOverdueSweeper` (`sweep.ts`, wired into `bootstrap.ts`, `OVERDUE_POLL_MS` default 60000) — emits `incident.overdue` + one `OVERDUE` notification per incident, once (`overdueNotifiedAt`). New endpoint `GET /api/users?kind=INTERNAL` → `{ users: [{ id, displayName }] }`, active internal users, `requireInternal`. `incident_status` email template (guest-safe, `{ ref, status }`). `AUDIT_ACTION_LABELS` + `guestAuditActionLabel` gain the `incident.*` entries (guest sees create / transitioned / resolved / closed only). Consumed by plan-03 (`ChangeIncidentLink` writes + the "caused by" / "fixes" drawer wiring), plan-04 (incident dashboard tiles, portal shell).

- [ ] **Step 4: Commit**

```bash
git add src/server/modules/incident/__tests__/lifecycle.integration.test.ts CONTRACTS.md plans/plan-02-incident.md
git commit -m "test: incident lifecycle integration; CONTRACTS plan-02 amendment

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Whole-branch review (before merge)

After Task 12, run the mandated review exactly as plan-01: two parallel focused reviewers against the full plan-02 diff —

1. **Security / isolation** — guest serializer is an exact allowlist (throwaway test: dump every key a guest sees for an incident in every state); cross-client incident read is 404-before-403; the guest create cannot set `impact` / `urgency` / `priority` / `reportedById` / `clientId`; comment scoping (internal-only comments never in a guest list); the activity timeline drops every internal-only `incident.*` action; `incident_status` email carries no internal vocabulary.
2. **Correctness** — the 9-cell priority matrix; `dueAt` recompute rules (yes while `NEW`/`ASSIGNED`, no after); `overdue` derived-not-stored on every read; the state machine rejects every illegal edge; `resolve` needs text; `close` only from `resolved`; the 14-day reopen window; the overdue sweep fires exactly once and is idempotent; `assignIncident` rejects a guest assignee and a resolved incident.

Both must come back clean (a fix wave is acceptable if small and re-gated). Then merge `worktree-keel-foundation` → `master` per the plan-01 procedure (`git merge --ff-only`), and update the SDD ledger.

---

## Self-review (writing-plans skill — done at authoring time)

- **Spec coverage.** §1 scope → Tasks 4–10. §2 data owned / `listLinkedChanges` → Task 4. §3 priority + SLA + overdue → Tasks 1, 6. §4 state machine → Task 2, enforced in 5–6. §5 API surface → Tasks 4–7, 9 (`/api/users`). §6 authorization (guest scoping, serializer strips, guest status words) → Tasks 3–4. §7 audit events → Tasks 4–6 + labels in Task 6. §8 notifications → Tasks 4–6. §9 UI (list + drawer) → Tasks 8–9. §10 test plan → every task's RED step + Task 12. §11 definition of done → Task 12 integration test. Spec 07 §4.3–§4.5 (portal) → Task 10.
- **Placeholder scan.** The pure modules (Tasks 1–3) and the service logic (Tasks 4–6) carry full code or precise pseudocode with every field named. The mechanical tasks (7, 9, 10) are "copy this shipped file, swap these named symbols" against a merged, on-disk reference — not "similar to Task N".
- **Type consistency.** `serializeIncident` takes `(actor, row, ctx)` everywhere it appears. `createIncident` takes the `CreateIncidentInternalInput | CreateIncidentGuestInput` union in the interface block, the schema task, the route, and the tests. `assertTransition` signature matches `state.ts` and every call site. `sweepOverdueIncidents` returns `{ flagged, cleared }` in the interface block and the test.
- **Known soft spots flagged for the executor:** the double-`emitNotification` in the Task 6 sweep sketch is called out as "use the single-call version". The `priority.ts`-from-a-client-component import in Task 9 is flagged "confirm the eslint boundary; inline a 6-line preview if it complains". The portal unread-comment dot is explicitly deferred to plan-04.
