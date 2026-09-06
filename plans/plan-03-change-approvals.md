# Change Management + Approvals Engine — Implementation Plan (Phase 1, plan-03)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the change lifecycle (RFC → risk/impact assessment → CAB approval → implementation window → PIR → close, with a rollback path), the generic multi-step hat-routed approvals engine that gates it, the demand→change conversion, and the `/changes` register + drawer + `/approvals` page.

**Architecture:** Two co-owned modules. `src/server/modules/approval/` is subject-agnostic — `openApprovalRequest` / `getApprovalState` / `recordDecision` / `cancelRequest`, all taking the caller's `tx`, all writing their own audit + notifications inside it. `src/server/modules/change/` owns `Change` / `ChangeIncidentLink` / `PostImplementationReview`, drives the `LifecycleStepper` via a server-computed `canAdvance`, and calls the approval engine at `submit-for-approval`. Every write is `route → withRequest → service(actor, tx, input) → authorize + domain write + writeAudit + emitNotification` inside one `runInTransaction`, exactly as `src/server/modules/demand/` and `src/server/modules/incident/` already do. A guest never reaches a change — `change.view` throws for a guest actor and there are no guest endpoints.

**Tech Stack:** Next 15.5.24 App Router, React 19.1.0, TypeScript strict + `noUncheckedIndexedAccess`, Prisma 6.19.3 / PostgreSQL 16, Zod ^4.5.4, Vitest 3.2.7, `@testing-library/react` ^16, CSS Modules (no Tailwind), the ported `LifecycleStepper` / `LifecyclePips` / `DataTable` / `Drawer` / `Pill` / `RiskLabel` components.

**Spec:** [`specs/03-change-management.md`](specs/03-change-management.md) + [`specs/04-approvals-engine.md`](specs/04-approvals-engine.md). Cross-refs: [`specs/data-model.md`](specs/data-model.md) §"Change" / §"Approvals engine", [`specs/00-foundation.md`](specs/00-foundation.md) §3–§4, [`specs/05-notifications.md`](specs/05-notifications.md), [`../CONTRACTS.md`](../CONTRACTS.md) (the authoritative interface freeze — read it, plus `plans/plan-01-demand.md`, `plans/plan-02-incident.md`, and the shipped `src/server/modules/demand/**` + `src/server/modules/incident/**` as the working pattern, before Task 1).

## Global Constraints

- **Node 22 LTS** target. Local dev on Node 24 tolerated.
- **No Tailwind, no component library.** UI uses `src/components/**` + CSS Modules. Colours come only from `tokens.css` custom properties — never a raw hex in a component or module.
- **Prisma boundary (eslint-enforced):** `@prisma/client` **value** imports only under `src/server/db/**`. `src/server/**` elsewhere uses the `prisma` singleton from `@/server/db/client` and `import type` for Prisma types. `src/app/**` imports neither. **Pure modules** (state machines, matrices) may `import type { $Enums }` and are then safe to import from a client component (proven in plan-02: `src/server/modules/incident/priority.ts` is imported by `IncidentDrawer.tsx`).
- **Every `api/**` route handler is wrapped in `withRequest`** (`@/lib/api/with-request`). A dynamic segment (`[id]`) uses the `export async function POST(req, { params })` form that awaits `params` then calls `withRequest(...)(req)` — see `src/app/api/incidents/[id]/transition/route.ts`.
- **Every domain write runs inside `runInTransaction`** (`@/server/db/tx`) and calls `writeAudit` for its state change in the same `tx`. Notifications go through `emitNotification` in the same `tx`. The approval engine's writes run inside the **consumer's** `tx` so a change transition and its approval-request row commit or roll back together.
- **Request bodies are parsed with a Zod schema** from `src/lib/api/schemas/changes.ts` / `.../approvals.ts`: `SCHEMA.parse(await req.json().catch(() => null))` → `ZodError` → `mapError` → 400. Zod 4 API: `z.enum([...])`, `z.iso.datetime()`.
- **Every `"use client"` component that talks to a route handler uses `apiFetch<T>`** from `@/lib/api/client` — never a bare `fetch`, never `as any`. `apiFetch` throws `ApiError` on non-2xx (parsed body attached), returns `undefined` for 204 / empty.
- **Record-of-fact tables.** `ApprovalDecision` and `PostImplementationReview` are append-only for `keel_app` at the DB privilege level (migration `20260903125809_audit_default_privileges` already revoked `UPDATE, DELETE`). The service must **never** `.update()` / `.upsert()` a row in either — only `.create()`. `scripts/check-migrations.mjs` (in the gate) already lists both in `RECORD_OF_FACT`. No new migration is needed for them.
- **TDD, RED first.** Each task: write the failing test, run it, see it fail for the right reason, implement the minimum, see it pass, commit. Never write implementation before its test.
- **Tests hit the disposable-database harness:** `import { withTestDb } from "@/test/db"` → `const db = withTestDb();`. Open transactions in tests with `db().$transaction(...)`, **not** `runInTransaction`. Route-handler tests use `withRouteTestDb()` from `@/test/route-db` (the two-statement seam — see `src/app/api/incidents/__tests__/incidents.route.test.ts`). Component tests: first line `/** @vitest-environment jsdom */`, then `afterEach(cleanup)`.
- **Test-actor literals** are typed `const x: Actor = {...}`, **not** `as const`. Seed helpers give every `Client` a unique `name`.
- **Caveman mode is for chat only.** Code, comments, commit messages, and this plan's prose stay in normal English. Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **`pnpm lint && pnpm typecheck && pnpm test && pnpm build` green before every commit.** `pnpm lint` includes `prettier --check .` — run `pnpm exec prettier --write` on new files first.
- **Enum casing:** the Prisma enums are `SCREAMING_SNAKE` (`ChangeStatus.ASSESSING`, `ChangeType.NORMAL`, `Level.HIGH`, `ApprovalStatus.PENDING`, `StepStatus.APPROVED`, `DecisionKind.REJECTED`, `ValueRealized.PARTIAL`, `LinkKind.FIXES`). The specs write them lowercase in prose — the code uses the enum values.
- **Do NOT stage `.claude/` or `.superpowers/`.** Do NOT run `pnpm dev` alongside `pnpm build`.

---

## Reconciliation rulings (specs 03/04 vs shipped Phase 0 + plans 01/02)

These resolve where the specs were written before the code froze. Treat them as part of the specs.

1. **No schema migration.** `Change`, `ChangeIncidentLink`, `PostImplementationReview`, `ApprovalRequest`, `ApprovalStep`, `ApprovalDecision` all ship in `prisma/schema.prisma` (Phase 0 Task 5/6) with every column these specs need. The `change.*` / `change.approve.*` policy rules (`src/server/policy/subjects/change.rule.ts`, `.../approval.rule.ts`), the `change.*` + `change.approve.technical` + `change.approve.business` actions, and the authorization-matrix cases (`src/server/policy/__tests__/matrix.cases.ts` — including the SoD override edges) **already ship**. plan-03 adds **no** migration and touches the policy layer only if a task proves a genuine gap.

2. **SoD override action names follow the shipped policy layer, not spec 04 §5's sketch.** Spec 04 §5 writes `overrideAction: "<policyKey>.step<order>.override"`; the frozen policy rules and the matrix tests use `"change.approve.technical.override"` and `"change.approve.business.override"`. Use the shipped names. `recordDecision`'s `SegregationError` carries the override action the **route's** `authorize(actor, "change.approve.<tier>", subject)` call already raised — the route lets it propagate to a 409; `recordDecision` itself only needs the `override.justification` to decide the override path (mirrors `decideDemand` in plan-01).

3. **`change.approve.*` is checked at the route, `recordDecision` re-checks defensively.** The route handler calls `authorize(actor, "change.approve.technical" | "change.approve.business", { type: "change", id, ownerId, riskLevel })` (which raises `ForbiddenError` / `SegregationError`), then calls `recordDecision(tx, { stepId, actor, decision, reason, override? })`. `recordDecision` re-verifies: step is current + pending (`ConflictError` — a **new** error class, → 409), `actor.hats` includes `step.requiredHat` (`ForbiddenError`), and the SoD check against `request.createdById` (`SegregationError` with `"change.approve.<tier>.override"` derived from `step.requiredHat`). Both layers must agree.

4. **`ConflictError` is a new domain error** in `src/server/policy/errors.ts` → **409** in `src/lib/api/errors.ts` `mapError`. Body `{ error: "conflict" }`. (Distinct from `SegregationError`'s 409 `{ error: "segregation", overrideAction }`.) The `mapError` branch order puts `ConflictError` above the generic 500 and below `SegregationError`. Add the row to the CONTRACTS §7 table.

5. **`changeType` in v1 is `NORMAL` or `EMERGENCY` only** (spec 03 §1). `STANDARD` is v2. `POST /api/changes` body accepts an optional `changeType` defaulting to `NORMAL`. An `EMERGENCY` change keeps every stage but MAY advance `approval → scheduled` before its approval request resolves; the request is still opened and its resolution must be recorded before the PIR gate passes (spec 03 §5). Model this as: the `approval → scheduled` gate is `approvalResolved || changeType === "EMERGENCY"`, and the `pir` stage's gate additionally requires `getApprovalState(...).status !== "PENDING"` for an emergency change.

6. **`change.view` never resolves for a guest** — the shipped rule is `requireInternal(actor)`. There is no guest serializer for a change and no `scopeToClient` on the change reads. A guest hitting any `/api/changes/**` route gets 403 (the `authorize` fires before the row load, so no existence oracle) — spec 03 §9 says "returns 404"; **ruling: 403 is correct and consistent with the shipped rule** (a guest is *known* and *not allowed*; `NotFoundError` is for "not yours" within a surface a guest legitimately uses). Update spec 03 §9's "404" to "403" in the plan's own test expectations.

7. **The demand→change conversion ships here** (`POST /api/demands/:id/convert`, the demand drawer's Convert button, the `demand.converted` audit event, `guestStatusLabel` for a `CONVERTED` demand following its linked change) — plan-01 Task 4 ruling 3 deferred all of it to plan-03. `createChangeFromDemand(tx, { demandId, actor })` is **idempotent on the `Change.originatingDemandId @unique` constraint**: if a change already exists for the demand, return it and do not write a second `demand.converted` audit event (catch `isUniqueViolation(e, "originatingDemandId")` from `@/server/db/errors`, re-read, return). The demand moves `APPROVED → CONVERTED` via `assertTransition` (already a legal edge in `src/server/modules/demand/state.ts`).

8. **`LifecyclePips` currentIndex / parkedIndex** — `LifecyclePips` (CONTRACTS §10) takes `stages: string[]`, `currentIndex: number`, `parkedIndex?`. For a change use `parkedIndex` for the `ROLLED_BACK` terminal (render it at the `implementing` position, tinted). For `LifecycleStepper` a `ROLLED_BACK` change pins every `Stage.state` to `"reverted"` (CONTRACTS §10 plan-1a Task 8 — that override makes every stage inert).

9. **`change.review` comments** use the shared comment module: `addComment(tx, { actor, subject: { type: "Change", id }, body, visibleToClient: false })`. `CommentSubject` for a Change is `{ type: "Change"; id }` — **no `clientId`** (CONTRACTS §4); the module treats a guest reaching a Change subject as `NotFoundError`, but a guest never gets that far here. Review is advisory — it never gates a transition.

10. **Module locations:** `src/server/modules/approval/` and `src/server/modules/change/`.

---

## File Structure

**Approval engine (`src/server/modules/approval/`)**

- `state.ts` — pure: `currentStep(steps)`, `resolveRequestStatus(steps)` (given the step statuses, is the request now `APPROVED` / `REJECTED` / still `PENDING`), `overrideActionFor(requiredHat)` (`TECHNICAL_APPROVER` → `"change.approve.technical.override"`, `BUSINESS_APPROVER` → `"change.approve.business.override"`). No Prisma.
- `service.ts` — `openApprovalRequest`, `getApprovalState`, `recordDecision`, `cancelRequest`, `listApprovalsForActor`. All authz + audit + notify.
- `serialize.ts` — `serializeApprovalState(state, actor)` → the shape `ApprovalPanel` consumes (steps + decisions + `currentStep` + a `needsOverride` flag when `actor.id === request.createdById` and holds the current hat).
- `src/lib/api/schemas/approvals.ts` — `recordDecisionBody` (`{ decision, reason, overrideJustification? }`).
- `src/app/api/approvals/route.ts` — `GET` (`listApprovalsForActor`).
- `src/app/api/approvals/[stepId]/decision/route.ts` — `POST` (`recordDecision` via the change route? — **ruling:** the decision route lives under `/api/changes/:id/approve/:tier` so the consumer's `authorize` runs with a fully-hydrated change subject; `src/app/api/approvals/**` is read-only. See Task 8.)

**Change module (`src/server/modules/change/`)**

- `state.ts` — pure: `CHANGE_STAGES` (the ordered stage list mapping to `ChangeStatus`), `CHANGE_TRANSITIONS`, `assertTransition`, and the gate predicates — `gateFor(stage, change, approvalStatus)` returning `{ items: GateItem[], canAdvance: boolean, blockedReason?: string }`. `import type { $Enums }` only — safe for the client drawer's preview.
- `serialize.ts` — `serializeChange(change, ctx)` (internal only — no guest branch) + `changeStatusLabel`.
- `service.ts` — `createChange`, `createChangeFromDemand`, `listChanges`, `getChangeForActor`, `editChange`, `linkIncident`, `advanceChange`, `scheduleChange`, `submitForApproval`, `recordPir`, `rollbackChange`, `changeApprovalContext(id)` (a narrow read the approve route needs: `{ ownerId, riskLevel, currentStepId, currentRequiredHat }`).
- `src/lib/api/schemas/changes.ts` — every change request body.
- `src/app/api/changes/route.ts` — `POST` (create), `GET` (list).
- `src/app/api/changes/[id]/route.ts` — `GET`.
- `src/app/api/changes/[id]/route.ts` `PATCH` — edit (or a sibling; keep `PATCH` on the same file).
- `src/app/api/changes/[id]/advance/route.ts`, `.../schedule/route.ts`, `.../submit-for-approval/route.ts`, `.../pir/route.ts`, `.../rollback/route.ts`, `.../link-incident/route.ts`, `.../comments/route.ts` (the `change.review` thread — copy of the incident comments route, `{ type: "Change", id }`).
- `src/app/api/changes/[id]/approve/[tier]/route.ts` — `POST`, `tier ∈ {technical, business}` — the approval-decision route.
- `src/app/api/demands/[id]/convert/route.ts` — `POST` (demand→change).

**Demand touch-ups**

- `src/server/modules/demand/service.ts` — add `convertDemand(actor, tx, id)` calling `createChangeFromDemand`.
- `src/server/modules/demand/serialize.ts` — `guestStatusLabel` `CONVERTED` branch: if a linked change is `CLOSED` → `"Delivered"`, else `"In progress"` (needs the linked change status passed into `serializeDemand`'s `guestTransform`; add a `linkedChangeStatus` to `getDemandForActor`'s row read).
- `src/app/(internal)/demands/DemandDrawer.tsx` — wire the Convert button (currently a disabled stub) to `POST /api/demands/:id/convert` → on success navigate to `/changes` (or open the new change).

**UI — change register, drawer, approvals**

- `src/app/(internal)/changes/page.tsx`, `ChangeRegister.tsx`, `ChangeDrawer.tsx`, `ScheduledWindows.tsx`, `changes.module.css`, `ChangeDrawer.module.css`.
- `src/components/ApprovalPanel/ApprovalPanel.tsx` + `index.ts` + `ApprovalPanel.module.css` — a **shared component** (spec 04 §8) so a v2 consumer reuses it. Props `{ state, actor, onDecision }`.
- `src/app/(internal)/approvals/page.tsx`, `ApprovalsList.tsx`, `approvals.module.css`.
- `src/app/(internal)/AppShellChrome.tsx` — append the `changes` and `approvals` `NavItem`s.

**Seed**

- `prisma/seed.ts` — `seedDemoChanges()` behind `NODE_ENV !== "production"`.

**Server wiring**

- `src/server/audit/labels.ts` — add every `change.*` + `approval.*` action to `AUDIT_ACTION_LABELS` (internal only; none are guest-visible — a guest never sees a change, and `guestAuditActionLabel` stays unchanged).
- `src/server/policy/errors.ts` — add `ConflictError`. `src/lib/api/errors.ts` — map it to 409.

**Tests** — colocated under each module's `__tests__/`, plus `src/server/modules/change/__tests__/lifecycle.integration.test.ts` and route tests under `src/app/api/changes/__tests__/`, `src/app/api/approvals/__tests__/`.

---

## Task 1: `ConflictError` + the approval state machine (pure)

**Files:**
- Modify: `src/server/policy/errors.ts` (add `ConflictError`), `src/lib/api/errors.ts` (map to 409), `CONTRACTS.md` §7 table
- Create: `src/server/modules/approval/state.ts`
- Test: `src/server/modules/approval/__tests__/state.test.ts`, extend `src/lib/api/__tests__/errors.test.ts` (or wherever `mapError` is tested)

**Interfaces:**
- Produces:
  ```ts
  // src/server/policy/errors.ts
  /** The subject is in a state that forbids this operation right now (an
   *  approval step that is not current, a request already resolved). → 409. */
  export class ConflictError extends Error {}

  // src/server/modules/approval/state.ts
  import type { $Enums } from "@prisma/client";
  export type StepView = { order: number; requiredHat: $Enums.Hat; status: $Enums.StepStatus };
  /** The lowest-order step still PENDING, or null if none. */
  export function currentStep<T extends StepView>(steps: readonly T[]): T | null;
  /** Given every step's status, the request's resulting status. */
  export function resolveRequestStatus(steps: readonly StepView[]): $Enums.ApprovalStatus;
  //   any REJECTED → "REJECTED"; all APPROVED → "APPROVED"; else "PENDING"
  export function overrideActionFor(requiredHat: $Enums.Hat): string;
  //   TECHNICAL_APPROVER → "change.approve.technical.override"
  //   BUSINESS_APPROVER  → "change.approve.business.override"
  //   (throws for any other hat — those never gate an approval step in v1)
  ```

- [ ] **Step 1: Write the failing tests**

`state.test.ts`:
```ts
import { expect, test } from "vitest";
import { currentStep, overrideActionFor, resolveRequestStatus } from "@/server/modules/approval/state";

const s = (order: number, requiredHat: "TECHNICAL_APPROVER" | "BUSINESS_APPROVER", status: "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED") => ({ order, requiredHat, status });

test("currentStep is the lowest-order PENDING step", () => {
  expect(currentStep([s(1, "TECHNICAL_APPROVER", "APPROVED"), s(2, "BUSINESS_APPROVER", "PENDING")])?.order).toBe(2);
  expect(currentStep([s(1, "TECHNICAL_APPROVER", "APPROVED"), s(2, "BUSINESS_APPROVER", "APPROVED")])).toBeNull();
  expect(currentStep([s(2, "BUSINESS_APPROVER", "PENDING"), s(1, "TECHNICAL_APPROVER", "PENDING")])?.order).toBe(1);
});

test("resolveRequestStatus: any rejection rejects the request; all-approved approves; else pending", () => {
  expect(resolveRequestStatus([s(1, "TECHNICAL_APPROVER", "APPROVED")])).toBe("APPROVED");
  expect(resolveRequestStatus([s(1, "TECHNICAL_APPROVER", "APPROVED"), s(2, "BUSINESS_APPROVER", "PENDING")])).toBe("PENDING");
  expect(resolveRequestStatus([s(1, "TECHNICAL_APPROVER", "REJECTED"), s(2, "BUSINESS_APPROVER", "PENDING")])).toBe("REJECTED");
  expect(resolveRequestStatus([s(1, "TECHNICAL_APPROVER", "APPROVED"), s(2, "BUSINESS_APPROVER", "APPROVED")])).toBe("APPROVED");
});

test("overrideActionFor maps the two approver hats and throws for others", () => {
  expect(overrideActionFor("TECHNICAL_APPROVER")).toBe("change.approve.technical.override");
  expect(overrideActionFor("BUSINESS_APPROVER")).toBe("change.approve.business.override");
  expect(() => overrideActionFor("DEVELOPER")).toThrow();
});
```

`mapError` test — add a case: a thrown `ConflictError` → `Response` with `status === 409` and JSON body `{ error: "conflict" }`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`errors.ts` — add the class next to `SegregationError`:
```ts
export class ConflictError extends Error {}
```
`src/lib/api/errors.ts` — add a branch **above** the generic 500, **below** `SegregationError`:
```ts
if (e instanceof ConflictError) {
  return Response.json({ error: "conflict" }, { status: 409 });
}
```
(Match the exact style of the neighbouring branches — check the file.)

`state.ts`:
```ts
import type { $Enums } from "@prisma/client";

export type StepView = {
  order: number;
  requiredHat: $Enums.Hat;
  status: $Enums.StepStatus;
};

export function currentStep<T extends StepView>(steps: readonly T[]): T | null {
  return (
    [...steps]
      .filter((s) => s.status === "PENDING")
      .sort((a, b) => a.order - b.order)[0] ?? null
  );
}

export function resolveRequestStatus(
  steps: readonly StepView[],
): $Enums.ApprovalStatus {
  if (steps.some((s) => s.status === "REJECTED")) return "REJECTED";
  if (steps.every((s) => s.status === "APPROVED")) return "APPROVED";
  return "PENDING";
}

const OVERRIDE_ACTIONS: Partial<Record<$Enums.Hat, string>> = {
  TECHNICAL_APPROVER: "change.approve.technical.override",
  BUSINESS_APPROVER: "change.approve.business.override",
};

export function overrideActionFor(requiredHat: $Enums.Hat): string {
  const action = OVERRIDE_ACTIONS[requiredHat];
  if (!action) {
    throw new Error(`no override action for the ${requiredHat} hat`);
  }
  return action;
}
```

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Update `CONTRACTS.md` §7** — add the `ConflictError` → 409 `{ error: "conflict" }` row to the `mapError` table.

- [ ] **Step 6: Commit**

```bash
git add src/server/policy/errors.ts src/lib/api/errors.ts src/server/modules/approval/ CONTRACTS.md src/lib/api/__tests__/
git commit -m "feat: ConflictError (409) and the approval state machine

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Approval engine — open, state, cancel

**Files:**
- Create: `src/server/modules/approval/service.ts` (`openApprovalRequest`, `getApprovalState`, `cancelRequest`), `src/server/modules/approval/serialize.ts`
- Test: `src/server/modules/approval/__tests__/service.test.ts`

**Interfaces:**
- Consumes: `writeAudit`, `emitNotification` (+ its `Recipients` type — `{ hat }`), `PrismaTransaction` / `prisma`, `Actor`, `currentStep` / `resolveRequestStatus` (`./state`).
- Produces:
  ```ts
  export type OpenApprovalInput = {
    subjectType: string;       // "change" in v1
    subjectId: string;
    createdById: string;       // the change owner — for the SoD check
    policyKey: string;         // "change.standard" | "change.high_risk"
    steps: { order: number; requiredHat: $Enums.Hat }[];
  };
  export function openApprovalRequest(tx: PrismaTransaction, input: OpenApprovalInput): Promise<{ id: string }>;

  export type ApprovalStateView = {
    requestId: string | null;
    status: $Enums.ApprovalStatus | null;   // null when no request has ever been opened
    policyKey: string | null;
    createdById: string | null;
    steps: {
      id: string; order: number; requiredHat: $Enums.Hat; status: $Enums.StepStatus;
      decision: { actorId: string; actorName: string; decision: $Enums.DecisionKind; reason: string; isSingleApproverOverride: boolean; overrideJustification: string | null; decidedAt: string } | null;
    }[];
    currentStep: { id: string; requiredHat: $Enums.Hat } | null;
  };
  export function getApprovalState(subjectType: string, subjectId: string, client?: PrismaClient): Promise<ApprovalStateView>;
  //   Returns the MOST RECENT request for the subject (spec 04 §3 — a re-submit opens a fresh one; the old stays in the log).

  export function cancelRequest(tx: PrismaTransaction, input: { subjectType: string; subjectId: string; reason: string; actorId: string }): Promise<void>;
  //   No-op (not an error) when there is no PENDING request. Sets the request CANCELLED, every PENDING step SKIPPED, resolvedAt now. Audits approval.request_cancelled.
  ```
  `serialize.ts`:
  ```ts
  export type ApprovalPanelView = ApprovalStateView & { needsOverride: boolean };
  //   needsOverride === true when currentStep is set AND actor.hats includes currentStep.requiredHat AND actor.id === createdById
  export function serializeApprovalState(state: ApprovalStateView, actor: Actor): ApprovalPanelView;
  ```

- [ ] **Step 1: Write the failing tests** (`service.test.ts`) — seed helpers like `src/server/modules/incident/__tests__/service.test.ts`:

```ts
test("openApprovalRequest creates a PENDING request with ordered steps and audits approval.request_opened; notifies holders of step 1's hat, excluding the creator", async () => {
  // seed: owner (TECHNICAL_APPROVER), a second TECHNICAL_APPROVER user, a BUSINESS_APPROVER user.
  // open a 2-step high_risk request created by the owner.
  // assert: 1 ApprovalRequest PENDING, 2 ApprovalStep rows (orders 1,2, hats TECHNICAL then BUSINESS, both PENDING).
  // one approval.request_opened audit. an APPROVAL_NEEDED notification to the OTHER technical approver, NOT to the owner.
});

test("getApprovalState returns the latest request with per-step decisions and the current step", async () => {
  // open a request; getApprovalState → status PENDING, currentStep = step 1, steps[0].decision === null.
});

test("getApprovalState returns { status: null } for a subject with no request", async () => {});

test("cancelRequest on a PENDING request → CANCELLED, PENDING steps SKIPPED, approval.request_cancelled audited", async () => {});

test("cancelRequest is a no-op when there is no pending request", async () => {});

test("a re-opened request is a fresh row; getApprovalState returns the newer one; the old request is untouched", async () => {
  // open, cancel, open again → 2 ApprovalRequest rows; getApprovalState.requestId === the 2nd.
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `service.ts`**

- `openApprovalRequest`: `tx.approvalRequest.create({ data: { subjectType, subjectId, policyKey, createdById, status: "PENDING", steps: { create: input.steps.map((s) => ({ order: s.order, requiredHat: s.requiredHat, status: "PENDING" })) } } })`. `writeAudit(tx, { actorId: input.createdById, action: "approval.request_opened", subjectType: "ApprovalRequest", subjectId: request.id, payload: { policyKey, subjectType, subjectId, stepHats: input.steps.map((s) => s.requiredHat) } })`. Notify the first step's hat: `emitNotification(tx, { recipients: { hat: input.steps[0]!.requiredHat }, kind: "APPROVAL_NEEDED", subjectType, subjectId, summary: \`Approval needed on ${subjectType} ${subjectId}\`, excludeActorId: input.createdById })`. Return `{ id: request.id }`.
  - **Subtlety (spec 04 §7):** if the only holder of the first step's hat is `createdById`, `emitNotification` with `excludeActorId` writes zero rows — that is correct, the UI surfaces the override path. No special-casing needed.
- `getApprovalState`: `client.approvalRequest.findFirst({ where: { subjectType, subjectId }, orderBy: { createdAt: "desc" }, include: { steps: { orderBy: { order: "asc" }, include: { decisions: { orderBy: { decidedAt: "asc" }, include: { actor: { select: { displayName: true } } } } } } } })`. Map to `ApprovalStateView`. Each step's `decision` is the **last** `ApprovalDecision` (there is at most one per step in v1, but take the last defensively). `currentStep` from `./state`'s `currentStep(steps)`.
- `cancelRequest`: `findFirst` the latest PENDING request; if none, return. `tx.approvalStep.updateMany({ where: { requestId, status: "PENDING" }, data: { status: "SKIPPED", resolvedAt: new Date() } })`; `tx.approvalRequest.update({ where: { id: requestId }, data: { status: "CANCELLED", resolvedAt: new Date() } })`; `writeAudit(tx, { actorId: input.actorId, action: "approval.request_cancelled", subjectType: "ApprovalRequest", subjectId: requestId, payload: { reason: input.reason } })`.

`serialize.ts`:
```ts
export function serializeApprovalState(state: ApprovalStateView, actor: Actor): ApprovalPanelView {
  const needsOverride =
    state.currentStep != null &&
    actor.hats.includes(state.currentStep.requiredHat) &&
    actor.id === state.createdById;
  return { ...state, needsOverride };
}
```

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/approval/
git commit -m "feat: approval engine — open request, read state, cancel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Approval engine — `recordDecision` (routing, current-step, hat, SoD, override)

**Files:**
- Modify: `src/server/modules/approval/service.ts` (`recordDecision`), `src/server/audit/labels.ts` (approval.* labels)
- Create: `src/lib/api/schemas/approvals.ts`
- Test: extend `src/server/modules/approval/__tests__/service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function recordDecision(
    tx: PrismaTransaction,
    input: {
      stepId: string;
      actor: Actor;
      decision: $Enums.DecisionKind;   // "APPROVED" | "REJECTED"
      reason: string;                  // required, non-empty (route schema enforces min 1; service re-trims)
      overrideJustification?: string;  // required (min 20 trimmed) iff SoD would block
    },
  ): Promise<{ requestStatus: $Enums.ApprovalStatus }>;
  ```
  Enforcement order (spec 04 §5):
  1. Load the step + its request + all sibling steps. If the request is not `PENDING`, or `currentStep(siblings)?.id !== stepId` → `ConflictError`.
  2. `actor.hats.includes(step.requiredHat)` — else `ForbiddenError`.
  3. `isCreator = actor.id === request.createdById`. `override = typeof overrideJustification === "string" && overrideJustification.trim().length >= 20`.
     - `isCreator && !override` → `throw new SegregationError(overrideActionFor(step.requiredHat))`.
     - `isCreator && override` → proceed, `singleApproverOverride = true`.
  4. `tx.approvalDecision.create({ data: { stepId, actorId: actor.id, decision, reason: reason.trim(), isSingleApproverOverride: singleApproverOverride, overrideJustification: singleApproverOverride ? overrideJustification!.trim() : null } })` — **`.create` only**, never update (record-of-fact).
  5. `tx.approvalStep.update({ where: { id: stepId }, data: { status: decision === "APPROVED" ? "APPROVED" : "REJECTED", resolvedAt: new Date() } })`.
  6. Recompute: reload sibling step statuses, `const requestStatus = resolveRequestStatus(next)`. If `requestStatus !== "PENDING"` → `tx.approvalRequest.update({ where: { id: request.id }, data: { status: requestStatus, resolvedAt: new Date() } })`.
  7. Audit: `approval.step_approved` or `approval.step_rejected` (payload `{ stepOrder, reason }`); if `singleApproverOverride` **also** `approval.override` (payload `{ stepOrder, justification, createdById: request.createdById, actorId: actor.id }`); if `requestStatus !== "PENDING"` **also** `approval.request_resolved` (payload `{ status: requestStatus }`).
  8. Notify: `APPROVED` + a next step exists → `emitNotification({ hat: nextStep.requiredHat, kind: "APPROVAL_NEEDED", …, excludeActorId: request.createdById })`. Request resolved → `emitNotification({ userIds: [request.createdById], kind: "STATUS_CHANGED", … })`. `singleApproverOverride` → `emitNotification({ audience: "ALL_INTERNAL", kind: "STATUS_CHANGED", summary: "A change approval used a single-approver override", excludeActorId: actor.id })`.

- [ ] **Step 1: Write the failing tests** (extend `service.test.ts`):

```ts
test("1-step request: one APPROVED decision resolves the request APPROVED", async () => {
  // open a 1-step change.standard request (owner is a DEVELOPER only, so not the approver — a separate TECHNICAL_APPROVER decides).
  // recordDecision(APPROVED) → { requestStatus: "APPROVED" }; request row APPROVED, resolvedAt set; step APPROVED.
  // approval.step_approved + approval.request_resolved audited (same requestId); a STATUS_CHANGED notification to the creator.
});

test("2-step high_risk: needs both; step 1 approval notifies the business approver; step 2 approval resolves it", async () => {});

test("a rejection at step 1 resolves the request REJECTED and step 2 never becomes current", async () => {
  // recordDecision(REJECTED, reason) → { requestStatus: "REJECTED" }; step 2 still PENDING; approval.step_rejected + approval.request_resolved.
});

test("recording a decision on a non-current step → ConflictError", async () => {
  // 2-step request; recordDecision on step 2's id while step 1 is still PENDING → ConflictError.
});

test("recording a decision on an already-resolved request → ConflictError", async () => {});

test("an actor without the step's requiredHat → ForbiddenError", async () => {});

test("the creator approving their own step without an override → SegregationError('change.approve.technical.override')", async () => {
  // owner holds TECHNICAL_APPROVER and is request.createdById.
  await expect(...).rejects.toMatchObject({ overrideAction: "change.approve.technical.override" });
});

test("the creator with a <20-char justification → still SegregationError (treated as no override)", async () => {});

test("the creator with a >=20-char justification → decision recorded, isSingleApproverOverride true, approval.override AND approval.step_approved both audited, all internal users notified", async () => {});

test("recordDecision writes ApprovalDecision with .create only (row is immutable for keel_app)", async () => {
  // a second recordDecision on the same (now resolved) step → ConflictError, so there is never a real update path; assert exactly one ApprovalDecision row.
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `recordDecision`** per the enforcement order above. Add `recordDecisionBody` to `src/lib/api/schemas/approvals.ts`:
```ts
import { z } from "zod";
export const recordDecisionBody = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().min(1).max(2000),
  overrideJustification: z.string().trim().min(20).max(2000).optional(),
});
export type RecordDecisionBody = z.infer<typeof recordDecisionBody>;
```

- [ ] **Step 4: Add the `approval.*` labels** to `src/server/audit/labels.ts` `AUDIT_ACTION_LABELS`:
```ts
"approval.request_opened": "Approval requested",
"approval.step_approved": "Approval step approved",
"approval.step_rejected": "Approval step rejected",
"approval.request_resolved": "Approval resolved",
"approval.request_cancelled": "Approval cancelled",
"approval.override": "Single-approver override",
```
(None are guest-visible — `guestAuditActionLabel` is unchanged.)

- [ ] **Step 5: Run, verify pass. Full gate.**

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/approval/ src/lib/api/schemas/approvals.ts src/server/audit/labels.ts
git commit -m "feat: approval engine — recordDecision with routing, SoD, and override

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Change state machine + gate predicates (pure)

**Files:**
- Create: `src/server/modules/change/state.ts`
- Test: `src/server/modules/change/__tests__/state.test.ts`

**Interfaces:**
- Produces:
  ```ts
  import type { $Enums } from "@prisma/client";

  export type ChangeStageKey = "draft" | "assessing" | "approval" | "scheduled" | "implementing" | "pir" | "closed";
  export const CHANGE_STAGES: readonly { key: ChangeStageKey; label: string; status: $Enums.ChangeStatus }[];
  //   draft→DRAFT, assessing→ASSESSING, approval→APPROVAL, scheduled→SCHEDULED, implementing→IMPLEMENTING, pir→PIR, closed→CLOSED
  export const CHANGE_TRANSITIONS: Record<$Enums.ChangeStatus, readonly $Enums.ChangeStatus[]>;
  //   DRAFT→[ASSESSING]; ASSESSING→[APPROVAL]; APPROVAL→[SCHEDULED, ASSESSING]; SCHEDULED→[IMPLEMENTING];
  //   IMPLEMENTING→[PIR, ROLLED_BACK]; PIR→[CLOSED]; CLOSED→[]; ROLLED_BACK→[]
  export function assertTransition(from: $Enums.ChangeStatus, to: $Enums.ChangeStatus): void; // throws ForbiddenError

  export type GateInput = {
    rfc: string | null; riskLevel: $Enums.Level | null; impactAssessment: string | null;
    rollbackPlan: string | null; originatingDemandId: string | null; standaloneConfirmed: boolean;
    windowStart: Date | null; windowEnd: Date | null; changeType: $Enums.ChangeType;
    valueRealized: $Enums.ValueRealized | null; lessons: string | null;
    wentToPlanAcknowledged: boolean;
  };
  export type GateResult = { items: { key: string; label: string; hint?: string; done: boolean }[]; canAdvance: boolean; blockedReason?: string };
  export function gateFor(
    stage: ChangeStageKey,
    input: GateInput,
    approvalStatus: $Enums.ApprovalStatus | null,   // from getApprovalState
    now: Date,
  ): GateResult;
  ```
  Gate rules (spec 03 §3):
  - `draft`: `rfc` non-empty; (`originatingDemandId != null` OR `standaloneConfirmed`); (owner is always set at create — not a gate item, but list it `done: true` for the stepper's benefit). `canAdvance` = all items done.
  - `assessing`: `riskLevel != null`; `impactAssessment` non-empty; `rollbackPlan` non-empty; `testPlan noted` — **ruling:** "test plan noted in the RFC" is not a separate column; treat it as a gate item the actor checks (`done` is a free acknowledgement, tracked as `testPlanAcknowledged` on the change — add that boolean? No — v1: fold it into the RFC, make the gate item `rfc` contains a "test" mention OR an explicit `testPlanAcknowledged`). **Simplest v1 ruling:** the `assessing` gate items are `riskLevel`, `impactAssessment`, `rollbackPlan` only; the test-plan lives in the RFC prose and is the reviewer's concern, not a machine gate. Drop the test-plan gate item. Note the deviation.
  - `approval`: `approvalStatus === "APPROVED"` OR `changeType === "EMERGENCY"`. `blockedReason` when not: `approvalStatus === "PENDING"` → "Waiting on approval"; `approvalStatus === "REJECTED"` → "Approval was rejected — edit and resubmit"; `null` → "Submit for approval first".
  - `scheduled`: `windowStart != null && windowEnd != null && windowStart < windowEnd && windowStart > now`; `rollbackPlan` still non-empty.
  - `implementing`: one item, `wentToPlanAcknowledged` — a free acknowledgement checkbox ("the change went to plan"). If the actor instead marks it did NOT go to plan, the drawer calls `/rollback`, not `/advance` — so `gateFor` just reports `canAdvance: wentToPlanAcknowledged`.
  - `pir`: `valueRealized != null`; `lessons` non-empty; for an `EMERGENCY` change additionally `approvalStatus != null && approvalStatus !== "PENDING"` (spec 03 §5 — the retrospective approval must be resolved before PIR closes). `blockedReason` for the emergency case: "Record the retrospective approval decision first".
  - `closed`: terminal — `canAdvance: false`, no items.

- [ ] **Step 1: Write the failing tests** — exhaustive over the gate rules. Sample:

```ts
import { expect, test } from "vitest";
import { CHANGE_TRANSITIONS, assertTransition, gateFor } from "@/server/modules/change/state";
import { ForbiddenError } from "@/server/policy/errors";

const base = { rfc: null, riskLevel: null, impactAssessment: null, rollbackPlan: null, originatingDemandId: null, standaloneConfirmed: false, windowStart: null, windowEnd: null, changeType: "NORMAL" as const, valueRealized: null, lessons: null, wentToPlanAcknowledged: false };
const now = new Date("2026-09-10T00:00:00Z");

test("transitions", () => {
  expect(() => assertTransition("DRAFT", "ASSESSING")).not.toThrow();
  expect(() => assertTransition("APPROVAL", "ASSESSING")).not.toThrow(); // rejection path
  expect(() => assertTransition("IMPLEMENTING", "ROLLED_BACK")).not.toThrow();
  expect(() => assertTransition("DRAFT", "APPROVAL")).toThrow(ForbiddenError);
  expect(() => assertTransition("CLOSED", "PIR")).toThrow(ForbiddenError);
});

test("draft gate: RFC + a demand link or a standalone confirmation", () => {
  expect(gateFor("draft", base, null, now).canAdvance).toBe(false);
  expect(gateFor("draft", { ...base, rfc: "the plan", standaloneConfirmed: true }, null, now).canAdvance).toBe(true);
  expect(gateFor("draft", { ...base, rfc: "the plan", originatingDemandId: "d1" }, null, now).canAdvance).toBe(true);
});

test("assessing gate needs risk, impact, and a rollback plan", () => {
  const ok = { ...base, riskLevel: "LOW" as const, impactAssessment: "small", rollbackPlan: "revert the migration" };
  expect(gateFor("assessing", ok, null, now).canAdvance).toBe(true);
  expect(gateFor("assessing", { ...ok, rollbackPlan: null }, null, now).canAdvance).toBe(false);
});

test("approval gate: APPROVED status, or EMERGENCY change type; blockedReason otherwise", () => {
  expect(gateFor("approval", base, "APPROVED", now).canAdvance).toBe(true);
  expect(gateFor("approval", { ...base, changeType: "EMERGENCY" }, "PENDING", now).canAdvance).toBe(true);
  const blocked = gateFor("approval", base, "PENDING", now);
  expect(blocked.canAdvance).toBe(false);
  expect(blocked.blockedReason).toMatch(/waiting on approval/i);
  expect(gateFor("approval", base, "REJECTED", now).blockedReason).toMatch(/rejected/i);
});

test("scheduled gate: a future window with start < end and a rollback plan", () => {
  const win = { ...base, rollbackPlan: "revert", windowStart: new Date("2026-09-12T09:00:00Z"), windowEnd: new Date("2026-09-12T11:00:00Z") };
  expect(gateFor("scheduled", win, "APPROVED", now).canAdvance).toBe(true);
  expect(gateFor("scheduled", { ...win, windowStart: new Date("2026-09-05T09:00:00Z") }, "APPROVED", now).canAdvance).toBe(false); // past
  expect(gateFor("scheduled", { ...win, windowEnd: new Date("2026-09-12T08:00:00Z") }, "APPROVED", now).canAdvance).toBe(false); // end < start
});

test("pir gate: valueRealized + lessons; for EMERGENCY also a resolved approval", () => {
  const pir = { ...base, valueRealized: "YES" as const, lessons: "went fine" };
  expect(gateFor("pir", pir, "APPROVED", now).canAdvance).toBe(true);
  expect(gateFor("pir", { ...pir, changeType: "EMERGENCY" }, "PENDING", now).canAdvance).toBe(false);
  expect(gateFor("pir", { ...pir, changeType: "EMERGENCY" }, "APPROVED", now).canAdvance).toBe(true);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `state.ts`.** `assertTransition` mirrors the incident/demand ones (`ForbiddenError` on an undeclared edge). `gateFor` is a `switch (stage)` returning the `GateResult` per the rules above.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/change/state.ts src/server/modules/change/__tests__/
git commit -m "feat: change state machine and lifecycle gate predicates

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Change service — create, from-demand, list, get, serialize

**Files:**
- Create: `src/server/modules/change/service.ts`, `src/server/modules/change/serialize.ts`, `src/lib/api/schemas/changes.ts`, `src/app/api/changes/route.ts`, `src/app/api/changes/[id]/route.ts`
- Test: `src/server/modules/change/__tests__/service.test.ts`, `src/app/api/changes/__tests__/changes.route.test.ts`

**Interfaces:**
- Consumes: `authorize`, `nextRef` (prefix `"CHG"`), `writeAudit`, `emitNotification`, `runInTransaction` / `PrismaTransaction` / `prisma`, `Actor` / `requireInternal`, `isUniqueViolation` (`@/server/db/errors`), `getApprovalState` (`@/server/modules/approval/service`), `serializeApprovalState`, `CHANGE_STAGES` / `gateFor` (`./state`).
- Produces:
  ```ts
  export type CreateChangeInput = { title: string; rfc: string; changeType?: $Enums.ChangeType; originatingDemandId?: string };
  export function createChange(actor: Actor, tx: PrismaTransaction, input: CreateChangeInput): Promise<{ id: string; ref: string }>;

  /** Idempotent on Change.originatingDemandId @unique. Returns the existing change
   *  (no second audit event) if one already exists for the demand. Does NOT move
   *  the demand — the demand service's convertDemand does that after this returns. */
  export function createChangeFromDemand(tx: PrismaTransaction, input: { demandId: string; actor: Actor }): Promise<{ id: string; ref: string; created: boolean }>;

  export function listChanges(actor: Actor, filters: { status?: $Enums.ChangeStatus; mine?: boolean; scheduled?: boolean }, client?: PrismaClient): Promise<Record<string, unknown>[]>;
  export function getChangeForActor(actor: Actor, id: string, client?: PrismaClient): Promise<Record<string, unknown>>; // throws ForbiddenError for a guest, NotFoundError for a missing id
  ```
  `serialize.ts`:
  ```ts
  export function changeStatusLabel(s: $Enums.ChangeStatus): string;
  //   DRAFT "Draft" · ASSESSING "Assessing" · APPROVAL "In approval" · SCHEDULED "Scheduled" · IMPLEMENTING "Implementing" · PIR "Reviewing" · CLOSED "Closed" · ROLLED_BACK "Rolled back"
  export function serializeChange(
    row: ChangeWithRelations,
    ctx: { approval: ApprovalStateView; activity: { time: string; text: string }[]; canAdvanceByStage: Record<string, GateResult> },
  ): Record<string, unknown>;
  //   INTERNAL-ONLY. No allowlist, no guest branch — a guest never reaches this.
  //   Includes: the raw change fields, the resolved `stage` (from status), `approval` (serialized), `linkedIncidents`, `originatingDemand` { ref } | null, `activity`, and `stepper` (the LifecycleStepper stages + per-stage gate + canAdvance for the current stage).
  ```

- [ ] **Step 1: Write the failing tests**

`service.test.ts` — seed helpers like the incident tests. Cases:
```ts
test("createChange: ref CHG-nnnn, status DRAFT, owner = actor, change.created audited", async () => {
  // a DEVELOPER actor. assert ref matches /^CHG-\d{4}$/, ownerId === actor.id, status DRAFT, changeType NORMAL.
});

test("createChange with originatingDemandId links it and stores the id", async () => {});

test("createChangeFromDemand is idempotent: a second call returns the same change, created:false, and writes no second change.created audit", async () => {
  // seed an APPROVED demand. createChangeFromDemand twice.
  // 2nd call: same id, created === false; exactly one change.created audit event for that subjectId.
});

test("a guest cannot list or get a change (ForbiddenError)", async () => {
  // getChangeForActor(guestActor, id) → ForbiddenError (403). listChanges(guestActor, {}) → ForbiddenError.
});

test("listChanges ?mine and ?scheduled filters (internal)", async () => {});

test("getChangeForActor returns the stepper + gate for the current stage and the serialized approval state", async () => {
  // a DRAFT change with an RFC and no demand link → stepper.stages has 7 entries; the draft stage's gate.canAdvance is false (no standalone confirmation).
});
```

`changes.route.test.ts` — `withRouteTestDb`. Cases: no session → 401; a **guest** create/list/get → 403 `{ error: "forbidden" }`; a DEVELOPER create → 201 `{ id, ref }`; a REVIEWER-only (no DEVELOPER) create → 403; `GET` list returns an array.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `serialize.ts`** — `changeStatusLabel` (the map above) + `serializeChange`. `serializeChange` builds the `stepper` field: `CHANGE_STAGES.map((s) => ({ key: s.key, label: s.label, purpose: <a one-liner per stage>, gate: gateFor(s.key, gateInput, ctx.approval.status, new Date()).items }))`, plus `currentStageKey` (the stage whose `status === change.status`), `canAdvance` (`gateFor(currentStageKey, …).canAdvance`), `blockedReason` (`gateFor(...).blockedReason`). For a `ROLLED_BACK` change, set every stage's `state: "reverted"` (CONTRACTS §10). This is exactly the `LifecycleStepperProps` shape.

- [ ] **Step 4: Implement `service.ts` — create / from-demand / list / get**

- `createChange`: `authorize(actor, "change.create", { type: "change" })`. `const ref = await nextRef(tx, "CHG")`. `tx.change.create({ data: { ref, title, rfc: input.rfc, changeType: input.changeType ?? "NORMAL", status: "DRAFT", ownerId: actor.id, originatingDemandId: input.originatingDemandId ?? null } })`. `writeAudit(tx, { actorId: actor.id, action: "change.created", subjectType: "Change", subjectId: change.id, payload: { originatingDemandId: input.originatingDemandId ?? null } })`. Return `{ id, ref }`.
- `createChangeFromDemand`: read the demand (`tx.demand.findUnique({ where: { id: demandId }, select: { title: true, status: true } })`; `NotFoundError` if missing). `try { const ref = await nextRef(tx, "CHG"); const change = await tx.change.create({ data: { ref, title: demand.title, rfc: "", changeType: "NORMAL", status: "DRAFT", ownerId: input.actor.id, originatingDemandId: demandId } }); writeAudit(… "change.created" … payload: { originatingDemandId: demandId, fromDemand: true }); return { id: change.id, ref: change.ref, created: true }; } catch (e) { if (isUniqueViolation(e, "originatingDemandId")) { const existing = await tx.change.findFirstOrThrow({ where: { originatingDemandId: demandId } }); return { id: existing.id, ref: existing.ref, created: false }; } throw e; }`
- `listChanges`: `requireInternal(actor)` (throws `ForbiddenError` for a guest — no `scopeToClient`, changes have no client). `where` from `status` / `mine ? { ownerId: actor.id } : {}` / `scheduled ? { status: "SCHEDULED" } : {}`. `findMany({ where, include: { originatingDemand: { select: { ref: true } }, incidentLinks: true }, orderBy: { createdAt: "desc" } })`. Map through a light list serializer (ref, title, riskLevel, status/stage, originatingDemand.ref, windowStart, ownerId) — **not** the full `serializeChange` (no per-row approval fetch for the list).
- `getChangeForActor`: `requireInternal(actor)` first (403 for a guest, before the load — no existence oracle). `const row = await client.change.findUnique({ where: { id }, include: { originatingDemand: { select: { ref: true } }, incidentLinks: { include: { incident: { select: { ref: true } } } }, pir: true } })`; `if (!row) throw new NotFoundError("not found")`. `authorize(actor, "change.view", { type: "change", id })`. `const approval = await getApprovalState("change", id, client)`. Build `activity` from `auditEvent.findMany({ where: { subjectType: "Change", subjectId: id } })` (+ the approval events — `subjectType: "ApprovalRequest", subjectId: approval.requestId`) merged and sorted by `at`. Return `serializeChange(row, { approval, activity, ... })` with `serializeApprovalState(approval, actor)` inside.

- [ ] **Step 5: Implement the routes** (`route.ts` POST/GET, `[id]/route.ts` GET) — mirror `src/app/api/incidents/route.ts` and `.../[id]/route.ts`. Schemas in `changes.ts`:
```ts
import { z } from "zod";
const CHANGE_STATUSES = ["DRAFT","ASSESSING","APPROVAL","SCHEDULED","IMPLEMENTING","PIR","CLOSED","ROLLED_BACK"] as const;
export const createChangeBody = z.object({
  title: z.string().trim().min(1).max(200),
  rfc: z.string().trim().min(1).max(20000),
  changeType: z.enum(["NORMAL", "EMERGENCY"]).optional(),
  originatingDemandId: z.string().trim().min(1).optional(),
});
export const listChangesQuery = z.object({
  status: z.enum(CHANGE_STATUSES).optional(),
  mine: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  scheduled: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
});
```
(Use the `z.enum(["true","false"]).transform` form for the booleans — plan-02's fix wave established that `z.coerce.boolean()` is broken.)

- [ ] **Step 6: Run, verify pass. Full gate.**

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/change/ src/lib/api/schemas/changes.ts src/app/api/changes/
git commit -m "feat: change create, from-demand conversion, list, get, serializer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Change edit + link-incident

**Files:**
- Modify: `src/server/modules/change/service.ts` (`editChange`, `linkIncident`), `src/lib/api/schemas/changes.ts`
- Create: `src/app/api/changes/[id]/route.ts` `PATCH` (add to the existing file), `src/app/api/changes/[id]/link-incident/route.ts`
- Test: extend `src/server/modules/change/__tests__/service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function editChange(actor: Actor, tx: PrismaTransaction, id: string, input: { rfc?: string; riskLevel?: $Enums.Level; impactAssessment?: string; rollbackPlan?: string }): Promise<void>;
  export function linkIncident(actor: Actor, tx: PrismaTransaction, id: string, input: { incidentId: string; kind: $Enums.LinkKind }): Promise<void>;
  ```
- `editChange`: `authorize(actor, "change.edit", { type: "change", id, ownerId: <loaded> })` (the rule allows the owner or a DEVELOPER — load `ownerId` first, so the load is a `select: { ownerId: true, status: true }`). Reject edits once `status ∈ {IMPLEMENTING, PIR, CLOSED, ROLLED_BACK}` → `ForbiddenError("the change is locked for editing")`. `tx.change.update({ where: { id }, data: <the provided fields> })`. Audit `change.edited` (payload: the field names changed). If `riskLevel` was set → **also** `change.risk_assessed` (payload: `{ riskLevel }`). If `rollbackPlan` was set to a non-empty value → **also** `change.rollback_plan_set`.
- `linkIncident`: `authorize(actor, "change.edit", …)`. Verify the incident exists (`tx.incident.findUnique({ where: { id: incidentId }, select: { id: true } })` → `NotFoundError`). `tx.changeIncidentLink.create({ data: { changeId: id, incidentId, kind } })` — catch `isUniqueViolation` on `@@unique([changeId, incidentId, kind])` and treat as a no-op (idempotent). Audit `change.incident_linked` (payload: `{ incidentId, kind }`).

- [ ] **Step 1: Write the failing tests** (extend `service.test.ts`):
```ts
test("editChange updates fields and audits change.edited; setting riskLevel also audits change.risk_assessed; setting rollbackPlan also audits change.rollback_plan_set", async () => {});
test("editChange by a non-owner non-DEVELOPER → ForbiddenError", async () => {});
test("editChange is rejected once the change is IMPLEMENTING+", async () => {});
test("linkIncident CAUSED_BY / FIXES creates the join row, audits change.incident_linked, and is idempotent on a repeat", async () => {});
test("linkIncident with an unknown incidentId → NotFoundError", async () => {});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `editChange` + `linkIncident`. Schemas:
```ts
export const editChangeBody = z.object({
  rfc: z.string().trim().min(1).max(20000).optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  impactAssessment: z.string().trim().min(1).max(10000).optional(),
  rollbackPlan: z.string().trim().min(1).max(10000).optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field" });
export const linkIncidentBody = z.object({
  incidentId: z.string().trim().min(1),
  kind: z.enum(["CAUSED_BY", "FIXES"]),
});
```

- [ ] **Step 4: Implement the routes** — `PATCH` on `[id]/route.ts` (add alongside `GET`); `POST` on `link-incident/route.ts`. Both `runInTransaction`, return `{ ok: true }`.

- [ ] **Step 5: Run, verify pass. Full gate.**

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/change/ src/lib/api/schemas/changes.ts src/app/api/changes/
git commit -m "feat: change edit and incident linking

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Change advance + schedule + rollback + PIR

**Files:**
- Modify: `src/server/modules/change/service.ts` (`advanceChange`, `scheduleChange`, `rollbackChange`, `recordPir`), `src/lib/api/schemas/changes.ts`
- Create: `src/app/api/changes/[id]/advance/route.ts`, `.../schedule/route.ts`, `.../rollback/route.ts`, `.../pir/route.ts`
- Test: extend `src/server/modules/change/__tests__/service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function advanceChange(actor: Actor, tx: PrismaTransaction, id: string, input: { from: $Enums.ChangeStatus; acknowledgements?: Record<string, boolean> }): Promise<void>;
  export function scheduleChange(actor: Actor, tx: PrismaTransaction, id: string, input: { windowStart: Date; windowEnd: Date }): Promise<void>;
  export function rollbackChange(actor: Actor, tx: PrismaTransaction, id: string, input: { note: string }): Promise<void>;
  export function recordPir(actor: Actor, tx: PrismaTransaction, id: string, input: { valueRealized: $Enums.ValueRealized; lessons: string }): Promise<void>;
  ```
- **`advanceChange`** — the general stage-advance: load the change + `getApprovalState`; compute `const stage = CHANGE_STAGES.find((s) => s.status === row.status)`; `if (input.from !== row.status) throw new ConflictError("the change moved since you loaded it")`; `const gate = gateFor(stage.key, gateInput(row, input.acknowledgements), approval.status, new Date())`; `if (!gate.canAdvance) throw new ForbiddenError(gate.blockedReason ?? "the stage's exit gate is not satisfied")`. The `acknowledgements` object carries the free-checkbox gate values (`standaloneConfirmed`, `wentToPlanAcknowledged`) — merge them into the `GateInput`. Determine `to`: the single forward status in `CHANGE_TRANSITIONS[row.status]` that is not a backward/rollback edge (`DRAFT→ASSESSING`, `ASSESSING→APPROVAL`, `APPROVAL→SCHEDULED`, `SCHEDULED→IMPLEMENTING`, `IMPLEMENTING→PIR`, `PIR→CLOSED`). `assertTransition(row.status, to)`. `tx.change.update({ where: { id }, data: { status: to, ...(to === "IMPLEMENTING" ? { implementedAt: new Date() } : {}), ...(to === "CLOSED" ? { closedAt: new Date() } : {}) } })`. Audit `change.advanced` (payload `{ from, to, acknowledgements: input.acknowledgements ?? {} }`), plus the stage-specific event: `to === "IMPLEMENTING"` → also `change.implementing`; `to === "CLOSED"` → also `change.closed`. Notify per spec 03 §7 (`scheduled` / `implementing` / `pir` → "the other internal user" = `{ audience: "ALL_INTERNAL" }` minus the actor; `closed` → if the change has an `originatingDemandId`, notify that demand's `submittedById` with a guest-safe "Delivered" summary, and for each `FIXES`-linked incident notify its `reportedById` with "fixed" — these two are the Phase 2 cross-module wires, but write them here).
  - **`APPROVAL → SCHEDULED` is NOT driven by `advanceChange`** — it happens automatically inside the approve route when the request resolves `APPROVED` (Task 8), OR via `advanceChange` for an `EMERGENCY` change. So `advanceChange` from `APPROVAL`: allowed only when `gateFor("approval", …).canAdvance` (i.e. `approvalStatus === "APPROVED" || changeType === "EMERGENCY"`).
- **`scheduleChange`** — `authorize(actor, "change.schedule", …)`. Require `row.status ∈ {APPROVAL, SCHEDULED}` (you can set/adjust the window once approved and while scheduled). Validate `windowStart < windowEnd && windowStart > now` (else `ForbiddenError`). `tx.change.update({ data: { windowStart, windowEnd } })`. Audit `change.scheduled` (payload `{ windowStart, windowEnd }`). Does **not** change `status` — the `approval → scheduled` transition is a separate `advanceChange` (or the auto-advance in Task 8). **Ruling:** to keep the drawer simple, `scheduleChange` on an `APPROVAL`-status change that is `approvalStatus === "APPROVED"` may also perform the `assertTransition(APPROVAL, SCHEDULED)` + status update in the same call (so "set the window" and "enter Scheduled" are one action). Emit `change.advanced { from: "APPROVAL", to: "SCHEDULED" }` in that case.
- **`rollbackChange`** — `authorize(actor, "change.transition", …)`. Require `row.status === "IMPLEMENTING"`. `assertTransition("IMPLEMENTING", "ROLLED_BACK")`. `tx.change.update({ data: { status: "ROLLED_BACK", closedAt: new Date() } })`. Audit `change.rolled_back` (payload `{ note: input.note.trim() }`). Notify `{ audience: "ALL_INTERNAL" }`.
- **`recordPir`** — `authorize(actor, "change.pir", …)`. Require `row.status === "PIR"`. `tx.postImplementationReview.create({ data: { changeId: id, valueRealized: input.valueRealized, lessons: input.lessons.trim(), reviewedById: actor.id, reviewedAt: new Date() } })` — **`.create` only** (record-of-fact); catch `isUniqueViolation` on `changeId @unique` → `ConflictError("a PIR is already recorded")`. Audit `change.pir_recorded` (payload `{ valueRealized }`). Notify `{ audience: "ALL_INTERNAL" }`.

- [ ] **Step 1: Write the failing tests** (extend `service.test.ts`) — the mandated lifecycle coverage (spec 03 §9):
```ts
test("advanceChange DRAFT→ASSESSING requires RFC + a demand link or standalone ack", async () => {});
test("advanceChange ASSESSING→APPROVAL is blocked without a rollback plan", async () => {});
test("advanceChange APPROVAL→SCHEDULED blocked while the approval request is PENDING; allowed once APPROVED", async () => {});
test("an EMERGENCY change can advance APPROVAL→SCHEDULED with a still-PENDING request", async () => {});
test("advanceChange with a stale `from` → ConflictError", async () => {});
test("scheduleChange rejects a past window and an end-before-start window; a valid future window audits change.scheduled", async () => {});
test("rollbackChange from IMPLEMENTING → ROLLED_BACK, change.rolled_back audited, all internal users notified; a terminal change rejects further transitions", async () => {});
test("recordPir creates the PIR row (once), audits change.pir_recorded; a second recordPir → ConflictError", async () => {});
test("advancing to CLOSED with an originating demand notifies the demand's submitter with a 'Delivered' summary", async () => {});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** the four functions. Schemas:
```ts
export const advanceChangeBody = z.object({
  from: z.enum(CHANGE_STATUSES),
  acknowledgements: z.record(z.string(), z.boolean()).optional(),
});
export const scheduleChangeBody = z.object({
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
}).transform((b) => ({ windowStart: new Date(b.windowStart), windowEnd: new Date(b.windowEnd) }));
export const rollbackChangeBody = z.object({ note: z.string().trim().min(1).max(5000) });
export const pirBody = z.object({
  valueRealized: z.enum(["YES", "PARTIAL", "NO"]),
  lessons: z.string().trim().min(1).max(10000),
});
```

- [ ] **Step 4: Implement the routes** — all `POST`, dynamic `[id]` form, `runInTransaction`, `{ ok: true }`.

- [ ] **Step 5: Run, verify pass. Full gate.**

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/change/ src/lib/api/schemas/changes.ts src/app/api/changes/
git commit -m "feat: change advance, schedule, rollback, and PIR

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Submit-for-approval + the approval-decision route

**Files:**
- Modify: `src/server/modules/change/service.ts` (`submitForApproval`, `changeApprovalContext`)
- Create: `src/app/api/changes/[id]/submit-for-approval/route.ts`, `src/app/api/changes/[id]/approve/[tier]/route.ts`, `src/app/api/approvals/route.ts`
- Modify: `src/server/modules/approval/service.ts` (`listApprovalsForActor`)
- Test: extend `src/server/modules/change/__tests__/service.test.ts`, `src/app/api/changes/__tests__/approval-flow.route.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // change service
  export function submitForApproval(actor: Actor, tx: PrismaTransaction, id: string): Promise<void>;
  //   authorize(actor, "change.submit_for_approval", { type: "change", id, ownerId }).
  //   Require row.status === "ASSESSING" and a non-empty rollbackPlan + riskLevel + impactAssessment (else ForbiddenError).
  //   cancelRequest(tx, { subjectType: "change", subjectId: id, ... }) first (idempotent — clears any stale PENDING request from a prior rejected round).
  //   openApprovalRequest(tx, { subjectType: "change", subjectId: id, createdById: row.ownerId, policyKey: row.riskLevel === "HIGH" ? "change.high_risk" : "change.standard", steps: row.riskLevel === "HIGH" ? [{order:1,requiredHat:"TECHNICAL_APPROVER"},{order:2,requiredHat:"BUSINESS_APPROVER"}] : [{order:1,requiredHat:"TECHNICAL_APPROVER"}] }).
  //   assertTransition("ASSESSING", "APPROVAL"); tx.change.update({ status: "APPROVAL" }).
  //   writeAudit change.submitted_for_approval + change.advanced { from: "ASSESSING", to: "APPROVAL" }.

  export function changeApprovalContext(id: string, client?: PrismaClient): Promise<{ ownerId: string; riskLevel: $Enums.Level | null; status: $Enums.ChangeStatus; currentStepId: string | null; currentRequiredHat: $Enums.Hat | null }>;
  //   The narrow read the approve route needs to build the `authorize` subject and find the step id.

  // approval service
  export function listApprovalsForActor(actor: Actor, client?: PrismaClient): Promise<{
    subjectType: string; subjectId: string; subjectRef: string; subjectTitle: string;
    policyKey: string; currentRequiredHat: $Enums.Hat; needsOverride: boolean;
  }[]>;
  //   Every PENDING request whose current step's requiredHat the actor holds. `needsOverride` when actor.id === createdById.
  //   subjectRef/subjectTitle: for subjectType "change", join Change by id. (v1 has only changes.)
  ```

- **The approve route** `POST /api/changes/:id/approve/:tier` (`tier ∈ {technical, business}`):
  ```
  const ctx = await changeApprovalContext(id);
  if (!ctx.currentStepId) throw new ConflictError("no approval step is awaiting a decision");
  const action = tier === "technical" ? "change.approve.technical" : "change.approve.business";
  authorize(actor, action, { type: "change", id, ownerId: ctx.ownerId, riskLevel: ctx.riskLevel ?? undefined });
  //   ^ raises ForbiddenError (wrong hat / business-on-non-HIGH) or SegregationError (owner, no override) → the handler lets it propagate (403 / 409).
  const body = recordDecisionBody.parse(...);
  await runInTransaction((tx) => recordDecision(tx, { stepId: ctx.currentStepId!, actor, decision: body.decision, reason: body.reason, overrideJustification: body.overrideJustification }));
  //   Then: if the request just resolved APPROVED, auto-advance the change APPROVAL → SCHEDULED?  NO — spec 03 §3 says `scheduled` needs a window. Ruling: on APPROVED, leave the change at APPROVAL; the drawer's Schedule panel becomes active and scheduleChange performs the transition. On REJECTED, move the change back: assertTransition("APPROVAL", "ASSESSING") + tx.change.update({ status: "ASSESSING" }) + writeAudit change.advanced { from: "APPROVAL", to: "ASSESSING", reason: "approval rejected" }.  Do this inside the same tx as recordDecision.
  ```
  **Ruling:** the "on REJECTED move the change back to ASSESSING" logic lives in the **route handler's transaction**, after `recordDecision` returns `{ requestStatus: "REJECTED" }` — not inside `recordDecision` (which must stay subject-agnostic). Wrap both in one `runInTransaction`.

- [ ] **Step 1: Write the failing tests**

`service.test.ts`:
```ts
test("submitForApproval on a LOW-risk assessed change opens a 1-step TECHNICAL_APPROVER request and moves the change to APPROVAL", async () => {});
test("submitForApproval on a HIGH-risk change opens a 2-step request (TECHNICAL then BUSINESS)", async () => {});
test("submitForApproval without a rollback plan → ForbiddenError", async () => {});
test("re-submitting after a rejection cancels the stale request and opens a fresh one", async () => {});
```

`approval-flow.route.test.ts` (`withRouteTestDb`, the fullest integration at the route layer):
```ts
test("LOW-risk: owner submits, a different TECHNICAL_APPROVER approves via POST /approve/technical → request APPROVED, change still APPROVAL, Schedule now possible", async () => {});
test("HIGH-risk: tech approves then business approves; after tech, POST /approve/business by the tech user → 403 (wrong hat)", async () => {});
test("a rejection at the technical step: request REJECTED, change back to ASSESSING with the reason on the audit chain", async () => {});
test("the change OWNER hitting POST /approve/technical with no justification → 409 { error: 'segregation', overrideAction: 'change.approve.technical.override' }", async () => {});
test("the change owner with a >=20-char overrideJustification → 200, decision recorded as an override, approval.override audited, other internal users notified", async () => {});
test("POST /approve/technical when the request is already resolved → 409 { error: 'conflict' }", async () => {});
test("a guest hitting POST /api/changes/:id/approve/technical → 403", async () => {});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `submitForApproval`, `changeApprovalContext`, `listApprovalsForActor`, and the three routes.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/change/ src/server/modules/approval/ src/app/api/changes/ src/app/api/approvals/
git commit -m "feat: submit-for-approval, the approval-decision route, and /approvals data

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Demand → change conversion (wire-up)

**Files:**
- Modify: `src/server/modules/demand/service.ts` (`convertDemand`), `src/server/modules/demand/serialize.ts` (`guestStatusLabel` CONVERTED branch + `getDemandForActor` linked-change read), `src/server/audit/labels.ts` (`demand.converted`)
- Create: `src/app/api/demands/[id]/convert/route.ts`
- Modify: `src/app/(internal)/demands/DemandDrawer.tsx` (wire the Convert button)
- Test: extend `src/server/modules/demand/__tests__/service.test.ts`, `src/app/(internal)/demands/__tests__/drawer.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // demand service
  export function convertDemand(actor: Actor, tx: PrismaTransaction, id: string): Promise<{ changeId: string; changeRef: string }>;
  //   authorize(actor, "demand.convert", { type: "demand", id }).
  //   Load the demand; require status === "APPROVED" && worth.decision === "PURSUE" (else ForbiddenError).
  //   const { id: changeId, ref: changeRef, created } = await createChangeFromDemand(tx, { demandId: id, actor });
  //   if (created) { assertTransition(demand.status, "CONVERTED"); tx.demand.update({ where: { id }, data: { status: "CONVERTED" } }); writeAudit(demand.converted, payload { changeId, changeRef }); }
  //   return { changeId, changeRef };  (idempotent: a second call returns the same ids, writes nothing)
  ```
- `guestStatusLabel(status, decision, rejectionReason, linkedChangeStatus?)` — add a 4th param. `CONVERTED` branch: `linkedChangeStatus === "CLOSED"` → `"Delivered"`; else `"In progress"`. `getDemandForActor` adds `convertedToChange: { select: { status: true } }` to its `include` and passes `row.convertedToChange?.status ?? null` into `serializeDemand`'s `guestTransform`.

- [ ] **Step 1: Write the failing tests** (extend `service.test.ts`):
```ts
test("convertDemand on an APPROVED/PURSUE demand: creates a Change linked to the demand, moves the demand to CONVERTED, audits demand.converted", async () => {});
test("convertDemand is idempotent: a second call returns the same changeId and writes no second demand.converted audit", async () => {});
test("convertDemand on a PARKED (APPROVED but decision PARK) demand → ForbiddenError", async () => {});
test("a guest cannot convert (ForbiddenError)", async () => {});
test("getDemandForActor for a guest whose demand is CONVERTED and whose change is CLOSED shows status 'Delivered'", async () => {});
```
Drawer test: the Convert button (visible on `status: "APPROVED"`, `worth.decision: "PURSUE"`) now calls `POST /api/demands/d1/convert` and, on success, navigates (mock `useRouter().push`).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `convertDemand`, the serializer change, the `demand.converted` label (`"Converted to a change"`), the route, and the drawer wiring (replace the disabled stub button — `disabled={busy}`, `onClick` → `runWrite("POST", \`/api/demands/${id}/convert\`)` then `router.push("/changes")` — the drawer already imports `apiFetch`; add `useRouter`).

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/demand/ src/app/api/demands/[id]/convert/ "src/app/(internal)/demands/" src/server/audit/labels.ts
git commit -m "feat: demand to change conversion

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: `ApprovalPanel` component

**Files:**
- Create: `src/components/ApprovalPanel/ApprovalPanel.tsx`, `index.ts`, `ApprovalPanel.module.css`
- Test: `src/components/ApprovalPanel/__tests__/approval-panel.test.tsx`

**Interfaces:**
- Consumes: the `ApprovalPanelView` shape (Task 2/3 `serialize.ts`), `Pill`, `apiFetch` is NOT used here — the panel is presentational + calls an `onDecision` prop the drawer supplies.
- Produces:
  ```ts
  export type ApprovalPanelProps = {
    state: ApprovalPanelView;   // from serializeApprovalState
    viewer: { id: string; hats: string[] };
    /** Called with the decision; the drawer does the apiFetch to
     *  POST /api/changes/:id/approve/:tier and re-fetches. */
    onDecision: (input: { decision: "APPROVED" | "REJECTED"; reason: string; overrideJustification?: string }) => Promise<void>;
    busy?: boolean;
  };
  export function ApprovalPanel(props: ApprovalPanelProps): ReactNode;
  ```
  Renders (spec 04 §8):
  - the step list: each step's `order`, `requiredHat` (as a `Pill`), `status`, and — if decided — the decision (`actorName`, `decidedAt` relative, `reason`; an "override" badge + the `overrideJustification` when `isSingleApproverOverride`).
  - when `state.currentStep` is set AND `viewer.hats.includes(state.currentStep.requiredHat)`:
    - if `!state.needsOverride`: **Approve** / **Reject** buttons, each revealing a required reason textarea, calling `onDecision`.
    - if `state.needsOverride`: an **Override & approve** button that opens a dialog with a required ≥20-char justification textarea and copy stating plainly "This decision will be recorded in the audit log as a single-approver override." — on confirm calls `onDecision({ decision: "APPROVED", reason, overrideJustification })`.
  - when `state.status === "REJECTED"`: a banner "Approval was rejected — the change returned to assessing."
  - when `state.status == null`: "Not yet submitted for approval."

- [ ] **Step 1: Write the failing test** (`approval-panel.test.tsx`, jsdom). Cases:
  - renders each step with its hat and status
  - a viewer holding the current step's hat (not the creator) sees Approve/Reject; a viewer without it sees neither
  - the creator (needsOverride) sees "Override & approve", and the confirm is disabled until ≥20 chars are typed; on confirm `onDecision` is called with `overrideJustification`
  - a decided step shows the decider name + reason; an override step shows the badge + justification
  - `status: "REJECTED"` renders the banner

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.** Reuse the `OverrideDialog` pattern from `src/app/(internal)/demands/OverrideDialog.tsx` (a small inline dialog) — either import it if it is generic enough, or inline an equivalent. CSS Modules + tokens.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/components/ApprovalPanel/
git commit -m "feat: ApprovalPanel component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: `/approvals` page

**Files:**
- Create: `src/app/(internal)/approvals/page.tsx`, `ApprovalsList.tsx`, `approvals.module.css`
- Modify: `src/app/(internal)/AppShellChrome.tsx` (append the `approvals` NavItem)
- Test: `src/app/(internal)/approvals/__tests__/approvals.test.tsx`

**Interfaces:**
- `page.tsx` — server component; `getCurrentActor()` guard → `redirect("/login")`, `whoami()` for hats; `const items = await listApprovalsForActor(actor)`; render `<ApprovalsList items={items} />`.
- `ApprovalsList` (`"use client"` or server — it is a list with deep links, no interaction needed; make it a server component) — grouped by subject; each row: the subject ref + title, the `currentRequiredHat` as a `Pill`, a "needs your override (you submitted this)" flag when `needsOverride`, a link to `/changes?open=<subjectId>` (the change register opens that drawer — Task 12 reads `?open`).
- Nav item: `{ key: "approvals", label: "Approvals", href: "/approvals", icon: <a check-in-circle svg> }`.

- [ ] **Step 1: Write the failing test** — `ApprovalsList` renders a row per item with the ref, the hat pill, and the override flag where set; an empty state ("Nothing is waiting on you.") when `items` is empty.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** the page, list, CSS, nav item.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add "src/app/(internal)/approvals/" "src/app/(internal)/AppShellChrome.tsx"
git commit -m "feat: /approvals page and nav

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: Change register (`/changes`)

**Files:**
- Create: `src/app/(internal)/changes/page.tsx`, `ChangeRegister.tsx`, `ScheduledWindows.tsx`, `changes.module.css`
- Modify: `src/app/(internal)/AppShellChrome.tsx` (append the `changes` NavItem)
- Test: `src/app/(internal)/changes/__tests__/register.test.tsx`

**Interfaces:**
- `page.tsx` — server component; actor guard; parse `?status/?mine/?scheduled` with `listChangesQuery`; `listChanges(actor, filters)`; render `<ChangeRegister initialRows viewer={{ id, kind, hats }} />` + `<ScheduledWindows rows={scheduledRows} />` (a second, date-ordered `listChanges(actor, { scheduled: true })` — or filter the same rows client-side).
- `ChangeRegister` (`"use client"`) — a `DataTable` (spec 03 §8.1): columns `ref`, title, `<RiskLabel level={row.riskLevel} />` (from `@/components/Pill`), `<LifecyclePips stages={CHANGE_STAGE_LABELS} currentIndex={...} parkedIndex={row.status === "ROLLED_BACK" ? IMPLEMENTING_INDEX : undefined} />` + a text status `<Pill>`, originating demand ref, window (if scheduled), owner. `onRowClick` → open `<ChangeDrawer id={row.id} …>` (Task 13). Filters: status chips, "Mine", "Scheduled". Reads `?open=<id>` on mount to auto-open a drawer (for the `/approvals` deep link).
- `ScheduledWindows` — a compact date-ordered list of `{ ref, title, windowStart, windowEnd }`, standing in for the change calendar.
- `CHANGE_STAGE_LABELS` — import the labels from `@/server/modules/change/state` (`CHANGE_STAGES.map((s) => s.label)`) — pure, client-safe.
- Nav item: `{ key: "changes", label: "Changes", href: "/changes", icon: <a git-branch / shuffle svg> }`.

- [ ] **Step 1: Write the failing test** (`register.test.tsx`, jsdom, mock `next/navigation`). Cases: renders a row per change with ref/title/risk; the LifecyclePips reflect `currentIndex`; a `ROLLED_BACK` row shows the parked pip; the "Mine" chip filters; `?open=<id>` mounts the drawer (mock `apiFetch`).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — `page.tsx`, `ChangeRegister`, `ScheduledWindows`, CSS, nav item. For Task 12 the `ChangeDrawer` import is a **minimal real stub** (mirror the plan-02 Task 8 ruling: a `<Drawer>` + `apiFetch("/api/changes/:id")` showing ref/title/status) — Task 13 replaces it. Export `ChangeDrawer` + a `ChangeViewer` type from `./ChangeDrawer`.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add "src/app/(internal)/changes/" "src/app/(internal)/AppShellChrome.tsx"
git commit -m "feat: change register, scheduled-windows list, Changes nav

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 13: Change drawer (the centrepiece)

**Files:**
- Create/replace: `src/app/(internal)/changes/ChangeDrawer.tsx`, `ChangeDrawer.module.css`
- Create: `src/app/api/changes/[id]/comments/route.ts` (the `change.review` thread — copy of `src/app/api/incidents/[id]/comments/route.ts`, swap `Incident`→`Change`, `{ type: "Change", id }` **with no clientId**, `getChangeForActor`/no `changeClientId`, `authorize(actor, "change.review", { type: "change", id })` for the write — review comments are gated on the REVIEWER hat, not `comment.create`)
- Test: `src/app/(internal)/changes/__tests__/drawer.test.tsx`, `src/app/api/changes/__tests__/comments.route.test.ts`

**This mirrors `src/app/(internal)/incidents/IncidentDrawer.tsx` in structure.** `viewer` prop `{ id, kind, hats }`. On `open` it `apiFetch`es `GET /api/changes/:id` (which returns the serialized change incl. `stepper` + `approval` + `activity`) and `GET /api/changes/:id/comments`. Every write goes through `apiFetch`; re-fetch after.

Panels (spec 03 §8.2):
- **Header** — `ref`, title, `<RiskLabel>`, a status `<Pill>` (`changeStatusLabel`).
- **RFC** — a `<textarea>` (markdown source, no renderer in v1); gated on `change.edit` (owner or DEVELOPER); "Save" → `PATCH /api/changes/:id`.
- **Risk & impact** — `riskLevel` `<select>` + `impactAssessment` `<textarea>`; same edit gate; "Save".
- **Rollback plan** — a dedicated always-visible `<textarea>`; when empty, a loud empty state ("Required before approval"); same edit gate.
- **`LifecycleStepper`** — `import { LifecycleStepper } from "@/components/LifecycleStepper"`. Props straight from the serialized `change.stepper`: `stages`, `currentStageKey`, `canAdvance` (server-computed — never recompute), `blockedReason`, `onToggleGate` (for the free-checkbox gates only — `standaloneConfirmed`, `wentToPlanAcknowledged` — store them in local state and pass into the `/advance` `acknowledgements` body), `onAdvance` → `POST /api/changes/:id/advance { from: change.status, acknowledgements }`. `readOnly` when `status ∈ {CLOSED, ROLLED_BACK}`. A `ROLLED_BACK` change: the serializer already set every stage `state: "reverted"`.
- **Review** — the comment thread (`GET/POST /api/changes/:id/comments`), only shown/postable to a `REVIEWER`-hat viewer; comments render "Keel team" style is N/A (all internal) — show the real author name.
- **Approval panel** — `<ApprovalPanel state={change.approval} viewer={viewer} onDecision={...} busy={busy} />`. `onDecision` → `apiFetch("/api/changes/:id/approve/" + tier, { method: "POST", body: {...} })` where `tier` is derived from `change.approval.currentStep.requiredHat` (`TECHNICAL_APPROVER` → `technical`, `BUSINESS_APPROVER` → `business`); on a 409 `{ error: "segregation" }` open the override path (the panel handles the dialog; the drawer just re-calls with `overrideJustification`); on a 409 `{ error: "conflict" }` show "This step was already decided — refreshing." and re-fetch.
- **Schedule** — window `<input type="datetime-local">` pickers, shown once `status ∈ {APPROVAL (approved), SCHEDULED}`; "Save window" → `POST /api/changes/:id/schedule`. Per Task 7's ruling, saving a window on an approved `APPROVAL`-status change also advances it to `SCHEDULED`.
- **PIR** — `valueRealized` `<select>` + `lessons` `<textarea>`, shown once `status ∈ {IMPLEMENTING, PIR}`; "Record PIR" → `POST /api/changes/:id/pir` (only enabled at `PIR` status).
- **Rollback** — a "Mark rolled back" button shown only at `IMPLEMENTING`, revealing a required note → `POST /api/changes/:id/rollback`.
- **Links** — originating demand (deep link to `/demands?open=<id>` — or just show the ref), linked incidents with their kind; an "add link" control (incident id + kind) → `POST /api/changes/:id/link-incident`, gated on `change.edit`.
- **Timeline** — `<Timeline items={change.activity ?? []} />` (already merges the approval events).

- [ ] **Step 1: Write the failing test** (`drawer.test.tsx`, jsdom, mock `apiFetch`). Cases:
  - opens with ref / title / risk label / status pill
  - the RFC textarea is editable for the owner, read-only for a non-owner non-DEVELOPER
  - the LifecycleStepper renders the 7 stages; the current stage's Advance is disabled when `canAdvance: false` and shows `blockedReason`
  - toggling the "confirm standalone" gate checkbox and clicking Advance calls `POST /advance` with `acknowledgements: { standaloneConfirmed: true }`
  - the ApprovalPanel shows Approve/Reject for a viewer holding the current step's hat; a decision calls `POST /approve/technical`
  - the rollback-plan empty state shows the loud "Required before approval" message
  - posting a review comment (REVIEWER viewer) calls `POST /comments`

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** the drawer + CSS + the comments route.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add "src/app/(internal)/changes/" src/app/api/changes/[id]/comments/
git commit -m "feat: change drawer with the lifecycle stepper, approval panel, and review thread

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: Seed demo changes + lifecycle integration test + CONTRACTS amendment

**Files:**
- Modify: `prisma/seed.ts` (`seedDemoChanges()`), `CONTRACTS.md`, `plans/plan-03-change-approvals.md` (controller ticks the boxes)
- Create: `src/server/modules/change/__tests__/lifecycle.integration.test.ts`

- [ ] **Step 1: `seedDemoChanges()`** — behind `NODE_ENV !== "production"`, called from `main()` after `seedDemoIncidents()`. Compose with the existing seed (look up `admin@keel.local`, `ceo@keel.local`, `cto@keel.local`, and demand `DEM-9003` — the APPROVED/PURSUE one — by unique key). Fixed refs `CHG-9001..9003`, `upsert` on `ref`:
  - `CHG-9001` — `DRAFT`, standalone, `changeType NORMAL`, RFC written, no risk yet. "Upgrade the Postgres minor version."
  - `CHG-9002` — `SCHEDULED`, `riskLevel MEDIUM`, rollback plan set, a resolved `change.standard` approval (one `ApprovalDecision` APPROVED by `cto`), `windowStart`/`windowEnd` a few days out. `originatingDemandId` = `DEM-9003`'s id (and set `DEM-9003.status = "CONVERTED"`). "Add single sign-on to the client portal."
  - `CHG-9003` — `CLOSED`, `riskLevel HIGH`, a resolved 2-step `change.high_risk` approval, a `PostImplementationReview` (`valueRealized YES`), `implementedAt`/`closedAt` set, a `FIXES` link to `INC-9004`. "Fix the welcome-email template."
  Written directly (no audit/notification — display fixtures, like `seedDemoIncidents`). The `ApprovalRequest`/`ApprovalStep`/`ApprovalDecision` rows are created directly too (the seed is allowed to `.create` a decision — the REVOKE is only on `UPDATE`/`DELETE`, and the seed runs as the migrate role anyway). Update the `console.log`.

- [ ] **Step 2: Run `pnpm prisma db seed` twice** (idempotent), `pnpm typecheck && pnpm lint`.

- [ ] **Step 3: The integration test** — one `test()` walking spec 03 §10, all in `db().$transaction` / `runWithContext`:
  1. seed: an owner (`DEVELOPER`), a `TECHNICAL_APPROVER`, a `BUSINESS_APPROVER`, an APPROVED/PURSUE demand
  2. `convertDemand` → a Change linked to the demand, demand now `CONVERTED`, `demand.converted` audited
  3. `editChange` — RFC, `riskLevel: "HIGH"`, impact, rollback plan → `change.edited` + `change.risk_assessed` + `change.rollback_plan_set` audited
  4. `advanceChange` DRAFT→ASSESSING (RFC + demand link gate) → `change.advanced`
  5. `submitForApproval` → a 2-step request (TECHNICAL then BUSINESS), change now `APPROVAL`, `change.submitted_for_approval` audited, an `APPROVAL_NEEDED` notification to the technical approver
  6. technical `recordDecision(APPROVED)` → step 1 APPROVED, request still PENDING, `APPROVAL_NEEDED` to the business approver
  7. business `recordDecision(APPROVED)` → request APPROVED, `approval.request_resolved` audited, a `STATUS_CHANGED` notification to the owner
  8. `scheduleChange` (future window) → change `SCHEDULED`, `change.scheduled` + `change.advanced { from: APPROVAL, to: SCHEDULED }`
  9. `advanceChange` SCHEDULED→IMPLEMENTING → `change.implementing`, `implementedAt` set
  10. `advanceChange` IMPLEMENTING→PIR (wentToPlan ack)
  11. `recordPir(YES, lessons)` → PIR row created, `change.pir_recorded`
  12. `advanceChange` PIR→CLOSED → `change.closed`, `closedAt` set; the originating demand's `submittedById` gets a `STATUS_CHANGED` notification
  13. `getDemandForActor(guestActor, demandId)` → guest sees status `"Delivered"` (the linked change is CLOSED)
  14. a SoD sub-case: a lone `TECHNICAL_APPROVER` who is also the change owner submits, then `recordDecision(APPROVED)` without a justification → `SegregationError`; with a ≥20-char justification → succeeds, `isSingleApproverOverride`, both `approval.override` and `approval.step_approved` audited

- [ ] **Step 4: Run it, full gate green.**

- [ ] **Step 5: CONTRACTS.md amendment** — add a `plan-03` bullet under "Phase 1 amendments" summarising: `ConflictError` (409); `src/server/modules/approval/` (`openApprovalRequest` / `getApprovalState` / `recordDecision` / `cancelRequest` / `listApprovalsForActor`, the SoD + override at the engine layer, `approval.*` audit events); `src/server/modules/change/` (state machine + `gateFor`, the full service, `serializeChange` internal-only, `createChangeFromDemand` idempotent on `originatingDemandId`); the demand→change wire (`convertDemand`, `guestStatusLabel` follows the linked change to "Delivered"); `ApprovalPanel` component; the `/changes` + `/approvals` pages; the SoD override action names (`change.approve.<tier>.override`). Consumed by plan-04 (dashboards: approvals-waiting, change calendar, demand pipeline; the "Delivered"/"fixed" guest wires).

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts src/server/modules/change/__tests__/lifecycle.integration.test.ts CONTRACTS.md
git commit -m "test: change lifecycle integration; demo changes; CONTRACTS plan-03 amendment

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Whole-branch review (before merge)

Two parallel focused reviewers against the full plan-03 diff:

1. **Security / isolation** — no guest can list, read, or mutate a change or an approval (every `/api/changes/**` and `/api/approvals/**` route → 403 for a guest, verified per route); the change serializer has no guest branch and is never reached by a guest; `ApprovalDecision` / `PostImplementationReview` are only ever `.create`d, never updated (grep the change + approval services); the SoD gate cannot be bypassed (creator can never self-approve without a ≥20-char justification; the route `authorize` and `recordDecision` both enforce it); `approval.override` is always written alongside `approval.step_approved` for an override; the audit chain shares the consumer's `requestId`.
2. **Correctness** — the approval routing (1-step vs 2-step by risk; rejection resolves immediately; step 2 never becomes current after a step-1 rejection); the current-step invariant (`ConflictError` on a non-current or resolved step); `resolveRequestStatus` is correct for every step-status combination; the change gate predicates match spec 03 §3 exactly (especially `rollbackPlan` at `assessing → approval`, the future-window check, the EMERGENCY carve-outs); `assertTransition` rejects every illegal change edge; `createChangeFromDemand` idempotency holds under a real unique-violation; a rejected approval returns the change to `ASSESSING` with the reason on the audit chain; the `LifecycleStepper` `canAdvance` is server-computed and the drawer never recomputes it.

Both must come back clean (a small re-gated fix wave is acceptable). Then merge `worktree-keel-foundation` → `master` (`git merge --ff-only`), keep the worktree for plan-04, and update the SDD ledger.

---

## Self-review (writing-plans skill — done at authoring time)

- **Spec 03 coverage.** §1 scope → Tasks 5–9, 12, 13. §2 data owned / `createChangeFromDemand` → Tasks 5, 9. §3 lifecycle + gates → Task 4, enforced in 7–8. §4 API surface → Tasks 5–8 + 13 (comments). §5 approval routing hand-off → Task 8. §6 audit events → Tasks 5–9 + labels in Task 3/9. §7 notifications → Tasks 2–3, 7–8. §8 UI (register + drawer) → Tasks 12–13. §9 test plan → every task's RED + Task 14. §10 definition of done → Task 14 integration test.
- **Spec 04 coverage.** §1 scope → Tasks 2–3, 8, 10, 11. §2 data owned → Tasks 2–3. §3 model → Task 1 (`resolveRequestStatus`, `currentStep`) + Task 2/3. §4 contract → Tasks 2–3, 8. §5 authz + SoD → Task 3 + Task 8's route. §6 audit → Task 3. §7 notifications → Tasks 2–3. §8 `ApprovalPanel` + `/approvals` → Tasks 10, 11, 8 (`listApprovalsForActor`). §9 test plan → Tasks 2–3, 8, 14. §10 definition of done → Task 14.
- **Placeholder scan.** The pure modules (Tasks 1, 4) and the engine/service logic (Tasks 2–9) carry full code or precise pseudocode with every field named. The mechanical tasks (the comments routes, the register stubs) are "copy this shipped file, swap these named symbols" against merged on-disk references (`src/app/api/incidents/[id]/comments/route.ts`, `IncidentDrawer.tsx`, `IncidentRegister.tsx`).
- **Type consistency.** `gateFor(stage, input, approvalStatus, now)` — same 4-arg signature in Task 4's interface, its tests, and Task 5/7's call sites. `recordDecision`'s input shape (`{ stepId, actor, decision, reason, overrideJustification? }`) is identical in Tasks 3, 8, 10. `ApprovalStateView` / `ApprovalPanelView` — defined in Task 2, consumed unchanged in Tasks 3, 5, 8, 10, 13. `createChangeFromDemand` returns `{ id, ref, created }` in Task 5 and is consumed that way in Task 9. `changeApprovalContext` returns the same 5 fields in Task 8's interface and its route consumer.
- **Known soft spots flagged for the executor:** Task 4's "test plan gate item" is explicitly dropped (folded into the RFC) with a noted deviation. Task 7's ruling that `scheduleChange` can also perform the `APPROVAL → SCHEDULED` transition is called out so the drawer stays simple. Task 8's ruling that the "rejected → back to ASSESSING" logic lives in the route's transaction (not `recordDecision`) keeps the engine subject-agnostic. Ruling 6 (guest gets 403 not 404 on `/api/changes/**`) overrides spec 03 §9's literal "404".
