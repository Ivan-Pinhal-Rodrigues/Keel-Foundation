# Demand Management + App Entry — Implementation Plan (Phase 1, plan-01)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the demand intake → triage → worth-decision lifecycle end to end (API + register + drawer + prioritisation board + guest portal views), plus the app's login page and internal shell so the rest of Phase 1 has a place to live.

**Architecture:** Every write goes `route → withRequest → service(actor, tx, input) → authorize + domain write + writeAudit + emitNotification` inside one `runInTransaction`. Reads compose `authorize` (or `assertVisibleToGuest`) + a role-aware serializer. UI is server components that fetch from the same route handlers, with thin `"use client"` islands for interaction. Demand owns `Demand` + `WorthAssessment`; it never writes the `Change` table — conversion lands in plan-03.

**Tech Stack:** Next 15.5.24 App Router, React 19.1.0, TypeScript strict + `noUncheckedIndexedAccess`, Prisma 6.19.3 / PostgreSQL 16, Zod ^4.5.4, Vitest 3.2.7 (`environment: "node"`; component/route-handler tests add `/** @vitest-environment jsdom */` or `node` as needed), `@testing-library/react` ^16, CSS Modules (no Tailwind), Radix primitives via the ported components.

**Spec:** [`specs/01-demand-management.md`](specs/01-demand-management.md). Cross-refs: [`specs/00-foundation.md`](specs/00-foundation.md) §3–§4, [`specs/05-notifications.md`](specs/05-notifications.md), [`specs/07-guest-portal.md`](specs/07-guest-portal.md) §4, [`../CONTRACTS.md`](../CONTRACTS.md) (the authoritative Phase 0 interface freeze — read it before Task 2).

## Global Constraints

- **Node 22 LTS** target (`@types/node` pinned `^22`; Dockerfile `node:22-slim`). Local dev on Node 24 is tolerated.
- **No Tailwind, no component library.** UI uses the ported components in `src/components/**` and CSS Modules. Colours come only from the `tokens.css` custom properties — never a raw hex in a component.
- **Prisma boundary (eslint-enforced):** `@prisma/client` **value** imports only under `src/server/db/**`. `src/server/**` elsewhere uses the `prisma` singleton from `@/server/db/client` and `import type` for Prisma types. `src/app/**` imports neither — route handlers and pages call into `src/server/**`.
- **Every `api/**` route handler is wrapped in `withRequest`** (`@/lib/api/with-request`). Never resolve the session or actor by hand in a route.
- **Every domain write runs inside `runInTransaction`** (`@/server/db/tx`) and calls `writeAudit` for its state change in the same `tx`. Notifications go through `emitNotification` in the same `tx`.
- **Request bodies are parsed with a Zod schema** from `src/lib/api/schemas/<module>.ts`: `SCHEMA.parse(await req.json().catch(() => null))`. A parse failure throws `ZodError` → `mapError` → 400. Zod 4 API: `z.email()`, `z.iso.datetime()`, `z.enum([...])`.
- **Every `"use client"` component that talks to a route handler uses `apiFetch<T>`** from `@/lib/api/client` (plan-1a Task 7) — never a bare `fetch`, never `as any` on the response. `apiFetch` throws `ApiError` on a non-2xx (with the parsed body attached), returns `undefined` for a 204 / empty body, and takes an optional `schema` to parse + type the 2xx body (a schema mismatch throws `ZodError`, not `ApiError`). Applies to `DemandRegister`, `DemandDrawer`, `PrioritisationBoard`, `OverrideDialog`, `PortalDemandList`, `PortalDemandDetail`, and the already-shipped `LoginForm`.
- **TDD, RED first.** Each task: write the failing test, run it, see it fail for the right reason, implement the minimum, see it pass, commit. Never write implementation before its test.
- **Tests hit the disposable-database harness:** `import { withTestDb } from "@/test/db"` → `const db = withTestDb();`. Each test file gets its own `CREATE DATABASE … TEMPLATE` clone (plan-1a Task 11 — one migrate per suite run, then a near-instant file copy per file). Open transactions in tests with `db().$transaction(...)`, **not** `runInTransaction` (that binds to the `@/server/db/client` singleton, invisible to the test database — see `src/server/modules/notify/__tests__/emit.test.ts`). Route-handler tests use `withRouteTestDb()` from `@/test/route-db` (see Task 2).
- **Caveman mode is for chat only.** Code, comments, commit messages, and this plan's prose stay in normal English. Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **`pnpm lint && pnpm typecheck && pnpm test && pnpm build` must be green before every commit.** `pnpm lint` includes `prettier --check .` — run `pnpm exec prettier --write` on new files first.
- **Enum casing:** the Prisma enums are `SCREAMING_SNAKE` (`DemandStatus.SUBMITTED`, `DemandSource.CLIENT`, `WorthDecision.PURSUE`, `Effort.S`). Spec 01 §3 writes them lowercase for prose; the code uses the enum values.

---

## Reconciliation rulings (spec 01 vs shipped Phase 0)

These resolve where the spec was written before Phase 0 froze. Treat them as part of the spec.

1. **State machine.** `TRIAGING → WORTH_ASSESSED` happens when `businessValue`, `effort`, and `costOfDelay` are all set (the decision is **not** required for this transition — the spec §3 arrow text "decision recorded" is an error, contradicted by the separate `/decision` endpoint in §4). `WORTH_ASSESSED → APPROVED` on `decision ∈ {PURSUE, PARK}`; `WORTH_ASSESSED → REJECTED` on `decision = DROP` or an explicit `/reject`. `APPROVED` with `decision = PARK` may be re-decided (back to `WORTH_ASSESSED` then forward again).
2. **Field names follow the schema, not the spec's body sketches.** `PATCH /value` body is `{ businessValue: string, valueScore?: number }` (not `businessValueScore`). `PATCH /effort` body is `{ effort: "S"|"M"|"L", feasibility?: string }` (not `feasibilityNote`). `POST /decision` body is `{ decision, note?, overrideJustification? }` → writes `WorthAssessment.decisionNote` and, on override, `overrideJustification`.
3. **`POST /api/demands/:id/convert` is deferred to plan-03.** It must create the `Change` row, and the Change module owns that table (spec 01 §2: "only via the change module's published `createChangeFromDemand()`"). plan-01 builds everything up to and including `APPROVED`; plan-03 adds the convert route, the `demand.converted` audit event, the drawer's Convert button, and the mandated conversion-path tests. Spec 01 §10's "converted to a Change" clause moves to plan-03's definition of done.
4. **SoD override on `demand.decide`.** `authorize(actor, "demand.decide", subject)` throws `SegregationError("demand.decide.override")` when `actor.id === demand.submittedById`. The route lets it propagate → 409 `{ error: "segregation", overrideAction: "demand.decide.override" }`. On resubmit with `overrideJustification` (a string, **min 20 chars**, enforced by the Zod schema), the service takes the override path: `requireAnyHat(actor, ["BUSINESS_APPROVER", "TECHNICAL_APPROVER"])` from `@/server/policy/subjects/helpers` (the hat check without the SoD guard), records the decision with `isSingleApproverOverride: true` + `overrideJustification`, and writes **both** a `demand.decided` and a `demand.decide.override` audit event.
5. **Guest portal demand pages ship in plan-01** (`/portal/demands`, `/portal/demands/:id`) so spec 01 §10's "the guest sees the status progress in plain words" is testable here. plan-04 adds the portal shell polish and the incident portal pages.
6. **Module location:** `src/server/modules/demand/` (matching `src/server/modules/notify/` and `.../comment/`).

---

## File Structure

**API / server**

- `src/lib/api/schemas/demands.ts` — every demand request body as a Zod schema + `z.infer` type. One responsibility: the wire contract.
- `src/server/modules/demand/service.ts` — the demand use cases: `createDemand`, `listDemands`, `getDemandForActor`, `startTriage`, `scoreValue`, `scoreEffort`, `decideDemand`, `rejectDemand`. Each takes `(actor, tx, input)` (or `(actor, args)` for reads that open their own client). All authz + audit + notify live here.
- `src/server/modules/demand/serialize.ts` — `serializeDemand(actor, row)` (via `serializePick`) + `DEMAND_GUEST_KEYS` (the guest allowlist) + the guest status map (spec §5). Pure.
- `src/server/modules/demand/state.ts` — `assertTransition(from, to)` and the guard predicates (`canEnterWorthAssessed`, etc.). Pure, no Prisma. The one place the state machine lives.
- `src/app/api/demands/route.ts` — `POST` (create), `GET` (list).
- `src/app/api/demands/[id]/route.ts` — `GET` (one).
- `src/app/api/demands/[id]/triage/route.ts` — `POST`.
- `src/app/api/demands/[id]/value/route.ts` — `PATCH`.
- `src/app/api/demands/[id]/effort/route.ts` — `PATCH`.
- `src/app/api/demands/[id]/decision/route.ts` — `POST`.
- `src/app/api/demands/[id]/reject/route.ts` — `POST`.

**App shell & auth entry**

- `src/app/login/page.tsx` — server component; if already authed, redirect to `/demands`. Renders `<LoginForm next={…} />`.
- `src/app/login/LoginForm.tsx` — `"use client"`; email + password, posts to `/api/auth/login`, on 200 `router.push(next)`, on 401 shows an inline error.
- `src/app/login/login.module.css`.
- `src/app/page.tsx` — replace the scaffold with `redirect("/demands")`.
- `src/app/(internal)/layout.tsx` — server component; `getCurrentActor()` → if `null` or `kind !== "INTERNAL"` `redirect("/login")` (or `/portal` for a guest); a second `whoami()` for the display fields; renders `<AppShellChrome user={…}>` (which mounts `<AppShell>`).
- `src/app/(internal)/AppShellChrome.tsx` — `"use client"`; the nav array + `<LogoutButton>`, computes `currentKey` from `usePathname()`, mounts `<AppShell>`. Keeps `(internal)/layout.tsx` a server component.
- `src/app/portal/(guest)/layout.tsx` — server component; guest guard (`getCurrentActor()` → non-guest `redirect("/demands")`, no session `redirect("/login")`); minimal chrome (product mark + logout). A **route group** (`(guest)`), not a literal `portal/layout.tsx`: a literal-path layout would also wrap the public `portal/invite/[token]` redemption page and force an unauthenticated invitee through the guard, breaking onboarding. plan-04 expands this.

**UI — register, drawer, board**

- `src/app/(internal)/demands/page.tsx` — server component; reads `?status`, `?source`, `?mine`, `?view`; fetches the list; renders `<DemandRegister>` or `<PrioritisationBoard>`.
- `src/app/(internal)/demands/DemandRegister.tsx` — `"use client"`; `DataTable` + filter chips + sort control; row click opens `<DemandDrawer>`.
- `src/app/(internal)/demands/DemandDrawer.tsx` — `"use client"`; the `Drawer` with all panels; fetches `/api/demands/:id` on open; write actions call the PATCH/POST routes then re-fetch.
- `src/app/(internal)/demands/PrioritisationBoard.tsx` — `"use client"`; the value×effort card grid.
- `src/app/(internal)/demands/OverrideDialog.tsx` — `"use client"`; the SoD justification modal (a `Drawer` or a small inline dialog).
- `src/app/(internal)/demands/demands.module.css`, `DemandDrawer.module.css`, `PrioritisationBoard.module.css`.

**UI — guest portal**

- `src/app/portal/demands/page.tsx` — server component; guest-scoped list.
- `src/app/portal/demands/[id]/page.tsx` — server component; guest-scoped detail with plain-word status + comments.
- `src/app/portal/demands/PortalDemandList.tsx`, `PortalDemandDetail.tsx` — `"use client"` where interaction (new-comment box) is needed; otherwise server.
- `src/app/portal/demands/portal-demands.module.css`.

**Tests** — colocated: `src/server/modules/demand/__tests__/{service,serialize,state}.test.ts`, `src/app/api/demands/__tests__/*.route.test.ts`, `src/app/(internal)/demands/__tests__/*.test.tsx`, `src/app/login/__tests__/login.test.tsx`, `src/app/portal/demands/__tests__/*.test.tsx`.

---

## Task 1: App shell & auth entry

> **Shipped — commits `5644476..b5110a5`.** Pulled forward and built early (interleaved with plan-1a hardening) per a controller ruling, so the app had a first visible page. This section is now a **historical record** of what was built, corrected to match reality — do not re-implement. Key deltas from the original plan: `getCurrentActor()` / `whoami()` (`@/server/auth/current`) replaced `getActorOrNull()` (which returns `null` in a Server Component — see plan-1a Task 1); `sanitizeNext()` (`src/app/login/sanitize-next.ts`) replaced the inline `next=` string check (which had an open-redirect hole); the portal layout is a `(guest)` route group; `whoami()` was **not** created as a new `src/server/auth/whoami.ts` (it lives in `current.ts`).

**Files:**
- Create: `src/app/login/page.tsx`, `src/app/login/LoginForm.tsx`, `src/app/login/login.module.css`, `src/app/login/sanitize-next.ts`, `src/app/(internal)/layout.tsx`, `src/app/(internal)/AppShellChrome.tsx`, `src/app/(internal)/nav.ts`, `src/app/portal/(guest)/layout.tsx`, `src/components/LogoutButton/`
- Modify: `src/app/page.tsx`
- Test: `src/app/login/__tests__/login.test.tsx`, `src/app/login/__tests__/sanitize-next.test.ts`, `src/app/(internal)/__tests__/nav.test.ts`

**Interfaces:**
- Consumes: `getCurrentActor` / `whoami` + the `Me` type (`@/server/auth/current`), `AppShell` + `NavItem` (`@/components/AppShell`). `POST /api/auth/login` and `POST /api/auth/logout` already exist (Phase 0).
- **Known gap:** `LoginForm` shipped with a bare `fetch` (it predates plan-1a Task 7's `apiFetch`). A small follow-up should port it to `apiFetch` + catch `ApiError` (`status === 401` → the wrong-credentials message) — behaviour-preserving, ~10 lines, not blocking.
- Produces: the `/login` page, the `(internal)` route group with `<AppShell>` chrome, the `portal/(guest)` route group. Later demand-UI tasks put pages under `src/app/(internal)/demands/`.

- [ ] **Step 1: Write the failing test** — `src/app/login/__tests__/login.test.tsx`

```tsx
/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "@/app/login/LoginForm";

afterEach(cleanup);

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

test("submits credentials and routes to `next` on 200", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 200 }));

  render(<LoginForm next="/demands" />);
  await userEvent.type(screen.getByLabelText(/email/i), "ceo@keel.local");
  await userEvent.type(screen.getByLabelText(/password/i), "hunter2hunter2");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  await waitFor(() => expect(push).toHaveBeenCalledWith("/demands"));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/login",
    expect.objectContaining({ method: "POST" }),
  );
});

test("shows an inline error on 401 and does not navigate", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }),
  );
  render(<LoginForm next="/demands" />);
  await userEvent.type(screen.getByLabelText(/email/i), "x@y.z");
  await userEvent.type(screen.getByLabelText(/password/i), "wrongpassword");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect/i);
  expect(push).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm test src/app/login` → FAIL (`Cannot find module '@/app/login/LoginForm'`).

- [x] **Step 3: `LoginForm`** — controlled email/password inputs with `<label htmlFor>`; on submit `e.preventDefault()`, an empty-field guard, then `fetch("/api/auth/login", …)` (bare `fetch` — the `apiFetch` follow-up noted above); `res.ok` → `router.push(next || "/demands")`; `res.status === 401` → `"The email or password is incorrect."` in a `<p role="alert">`; button disabled while in flight. Styled via `login.module.css` tokens.

- [x] **Step 4: `login/page.tsx`** — `async` server component: `const actor = await getCurrentActor(); if (actor) redirect(actor.kind === "INTERNAL" ? "/demands" : "/portal");` (with a `// TODO(plan-06)` on the `/demands` target — becomes `/overview` once the dashboard ships). `next` is run through `sanitizeNext()` (`src/app/login/sanitize-next.ts`): `new URL(candidate, base)` + same-origin check → `${pathname}${search}${hash}`, else `/demands`. **Not** a bare `startsWith("/")` check — that let `?next=/%09//evil.com` through (control char stripped later by the router → external redirect). Renders a centred card + `<LoginForm next={next} />`.

- [x] **Step 5: `(internal)/layout.tsx` + `AppShellChrome`** — layout is `async`: `const actor = await getCurrentActor(); if (!actor) redirect("/login"); if (actor.kind !== "INTERNAL") redirect("/portal");` then `const me = await whoami(); if (!me) redirect("/login");` (the session can die between the two reads — `whoami()` and `getCurrentActor()` share one `React.cache`d session resolution, so this is not a second DB hit). `<AppShellChrome user={{ name: me.displayName, sub: hatSummary(me) }}>{children}</AppShellChrome>`. `hatSummary(me: Me)` is a local pure helper joining `me.hats` labels with `" · "` (or `"—"`). `AppShellChrome` (`"use client"`) holds the `NavItem[]` (just Demand for now — later plans append), `navKeyFor(pathname, nav)` from `src/app/(internal)/nav.ts` (a pure, unit-tested prefix match), mounts `<AppShell … topbar={<LogoutButton/>}>`. `LogoutButton` (`src/components/LogoutButton/`, `"use client"`): posts `/api/auth/logout` then `router.push("/login")`.
  - `whoami()` was **not** created as a new `src/server/auth/whoami.ts` — it already exists in `@/server/auth/current` (plan-1a Task 1), returning `Me = { id, kind, hats, clientId, displayName, email }`, reading the cookie via `next/headers`, wrapped in `React.cache`.

- [x] **Step 6: `src/app/page.tsx`** → `redirect("/demands")` with a `// TODO(plan-06)` marker (middleware bounces an unauthed hit to `/login`; a guest is bounced to `/portal` by `(internal)/layout`).

- [x] **Step 7: `portal/(guest)/layout.tsx`** — a **route group**, not a literal `portal/layout.tsx` (so the public `portal/invite/[token]` page is not wrapped). `async`; `getCurrentActor()` guard (no session → `/login`, non-guest → `/demands`); minimal chrome (product mark + `<LogoutButton>`). A `portal/(guest)/page.tsx` placeholder exists so `/portal` resolves post-redeem; plan-04 replaces the shell.

- [x] **Step 8: Tests** — `login.test.tsx` (form behaviour), `sanitize-next.test.ts` (the open-redirect cases), `nav.test.ts` (`navKeyFor` prefix match). Full gate green at `b5110a5`.

- [x] **Step 9: Committed** — `5644476..b5110a5`: `src/app/login/`, `src/app/(internal)/`, `src/app/portal/(guest)/`, `src/app/page.tsx`, `src/components/LogoutButton/`. (No `src/server/auth/whoami.ts` — see Step 5.) One fix round closed a `next=` open-redirect (the `sanitize-next.ts` above).

---

## Task 2: Demand service — create, list, get

**Files:**
- Create: `src/lib/api/schemas/demands.ts`, `src/server/modules/demand/service.ts`, `src/server/modules/demand/serialize.ts`, `src/app/api/demands/route.ts`, `src/app/api/demands/[id]/route.ts`
- Test: `src/server/modules/demand/__tests__/service.test.ts`, `src/server/modules/demand/__tests__/serialize.test.ts`, `src/app/api/demands/__tests__/demands.route.test.ts`

**Interfaces:**
- Consumes: `authorize` (`@/server/policy/authorize`), `scopeToClient` / `assertVisibleToGuest` (`@/server/policy/scope`), **`serializePick`** (`@/server/policy/serialize` — the allowlist guest serializer from plan-1a Task 3; **not** `serializeFor`, which is now marked internal-shaping-only because a denylist leaks a new column by omission), `nextRef` (`@/server/ids/ref`), `writeAudit` (`@/server/audit/write`), `emitNotification` (`@/server/modules/notify/emit`), `PrismaTransaction` / `runInTransaction` (`@/server/db/tx`), `prisma` (`@/server/db/client`), `Actor` / `isInternal` (`@/server/policy/actor`), `withRequest` / `getActor` (Phase 0).
- Produces:
  ```ts
  // src/server/modules/demand/serialize.ts
  export const DEMAND_GUEST_KEYS: readonly (keyof DemandWithWorth)[];
  //   ["id", "ref", "title", "problem", "source", "affectedService", "createdAt"]
  //   an ALLOWLIST — a guest sees only these plus the guestTransform output; a new
  //   column added to the row later stays hidden until deliberately added here.
  export function serializeDemand(actor: Actor, row: DemandWithWorth): Record<string, unknown>;
  export function guestStatusLabel(status: $Enums.DemandStatus, decision: $Enums.WorthDecision | null, rejectionReason: string | null): string;

  // src/server/modules/demand/service.ts
  export type CreateDemandInput = { title: string; problem: string; source: $Enums.DemandSource; affectedService?: string };
  export function createDemand(actor: Actor, tx: PrismaTransaction, input: CreateDemandInput): Promise<{ id: string; ref: string }>;
  export function listDemands(actor: Actor, filters: { status?: $Enums.DemandStatus; source?: $Enums.DemandSource; mine?: boolean }): Promise<Record<string, unknown>[]>;
  export function getDemandForActor(actor: Actor, id: string): Promise<Record<string, unknown>>; // throws NotFoundError
  ```
  `DemandWithWorth` = the Prisma `Demand` with `worth: WorthAssessment | null` and `client: { name } | null` included — a local type, not exported.

- [ ] **Step 1: Write the failing tests**

`src/server/modules/demand/__tests__/state.test.ts` is Task 3's; here write `serialize.test.ts` first (pure, fast):

```ts
import { expect, test } from "vitest";
import { serializeDemand, DEMAND_GUEST_KEYS, guestStatusLabel } from "@/server/modules/demand/serialize";

const internal = { id: "u1", kind: "INTERNAL", hats: [], clientId: null } as const;
const guest = { id: "g1", kind: "GUEST", hats: [], clientId: "c1" } as const;

const row = {
  id: "d1", ref: "DEM-0001", title: "T", problem: "P", source: "CLIENT",
  status: "TRIAGING", submittedById: "g1", clientId: "c1", affectedService: "billing",
  decidedAt: null, createdAt: new Date(), updatedAt: new Date(),
  worth: { id: "w1", demandId: "d1", businessValue: "high", valueScore: 8, effort: "M", costOfDelay: "grows", decision: null, decisionNote: null, isSingleApproverOverride: false, overrideJustification: null },
  client: { name: "Northwind" },
} as any;

test("internal reader sees the worth assessment", () => {
  const out = serializeDemand(internal, row);
  expect(out.worth).toBeTruthy();
  expect(out.status).toBe("TRIAGING");
});

test("guest reader gets exactly the allowlisted keys plus the guest transform, and a plain-word status", () => {
  const out = serializeDemand(guest, row);
  expect(Object.keys(out).sort()).toEqual(
    [...DEMAND_GUEST_KEYS, "status", "clientName"].sort(),
  );
  expect(out.worth).toBeUndefined(); // never in guestKeys → cannot leak
  expect(out.status).toBe("In review");
});

test("guestStatusLabel maps every state", () => {
  expect(guestStatusLabel("SUBMITTED", null, null)).toBe("In review");
  expect(guestStatusLabel("APPROVED", "PURSUE", null)).toBe("Approved");
  expect(guestStatusLabel("CONVERTED", "PURSUE", null)).toBe("In progress");
  expect(guestStatusLabel("REJECTED", "DROP", "out of scope")).toMatch(/declined/i);
});
```

`src/server/modules/demand/__tests__/service.test.ts`:

```ts
import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { runWithContext } from "@/server/context";
import { createDemand, listDemands, getDemandForActor } from "@/server/modules/demand/service";
import { NotFoundError } from "@/server/policy/errors";

const db = withTestDb();
const ctx = <T>(fn: () => Promise<T>) => runWithContext({ requestId: "r", actorId: "sys" }, fn);

async function seedClientAndGuest() {
  const client = await db().client.create({ data: { name: "N", isActive: true } });
  const guest = await db().user.create({ data: { email: `g-${client.id}@k`, passwordHash: "x", displayName: "G", kind: "GUEST", hats: [], clientId: client.id } });
  return { client, guest };
}

test("a guest creating a demand: ref allocated, client + submitter set server-side, audit written", async () => {
  const { client, guest } = await seedClientAndGuest();
  const guestActor = { id: guest.id, kind: "GUEST", hats: [], clientId: client.id } as const;

  const { id, ref } = await ctx(() =>
    db().$transaction((tx) => createDemand(guestActor, tx, { title: "Faster exports", problem: "reports take 20 min", source: "CLIENT" })),
  );

  const d = await db().demand.findUniqueOrThrow({ where: { id } });
  expect(ref).toMatch(/^DEM-\d{4}$/);
  expect(d.clientId).toBe(client.id);
  expect(d.submittedById).toBe(guest.id);
  expect(d.status).toBe("SUBMITTED");
  const audit = await db().auditEvent.findFirst({ where: { action: "demand.create", subjectId: id } });
  expect(audit).toBeTruthy();
});

test("a guest creating a demand notifies every active internal user", async () => {
  const { client, guest } = await seedClientAndGuest();
  const a = await db().user.create({ data: { email: `a-${client.id}@k`, passwordHash: "x", displayName: "A", kind: "INTERNAL", hats: ["DEVELOPER"] } });
  const guestActor = { id: guest.id, kind: "GUEST", hats: [], clientId: client.id } as const;

  const { id } = await ctx(() => db().$transaction((tx) => createDemand(guestActor, tx, { title: "T", problem: "P", source: "CLIENT" })));
  const notes = await db().notification.findMany({ where: { subjectId: id } });
  expect(notes.map((n) => n.userId)).toContain(a.id);
});

test("guest list is scoped to the guest's own client; cross-client get is a 404", async () => {
  const one = await seedClientAndGuest();
  const two = await seedClientAndGuest();
  const oneActor = { id: one.guest.id, kind: "GUEST", hats: [], clientId: one.client.id } as const;

  const dOne = await ctx(() => db().$transaction((tx) => createDemand(oneActor, tx, { title: "mine", problem: "p", source: "CLIENT" })));
  await ctx(() => db().$transaction((tx) => createDemand({ id: two.guest.id, kind: "GUEST", hats: [], clientId: two.client.id } as const, tx, { title: "theirs", problem: "p", source: "CLIENT" })));

  const list = await listDemands(oneActor, {});
  expect(list.map((d) => d.title)).toEqual(["mine"]);
  await expect(getDemandForActor(oneActor, "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
});

test("an internal user creating a demand: no client, source INTERNAL allowed, no guest-created notification storm", async () => {
  const u = await db().user.create({ data: { email: "i@k", passwordHash: "x", displayName: "I", kind: "INTERNAL", hats: ["DEVELOPER"] } });
  const actor = { id: u.id, kind: "INTERNAL", hats: ["DEVELOPER"], clientId: null } as const;
  const { id } = await ctx(() => db().$transaction((tx) => createDemand(actor, tx, { title: "tech debt", problem: "p", source: "TECH_DEBT" })));
  const d = await db().demand.findUniqueOrThrow({ where: { id } });
  expect(d.clientId).toBeNull();
  expect(await db().notification.count({ where: { subjectId: id } })).toBe(0);
});
```

`src/app/api/demands/__tests__/demands.route.test.ts` — a light route-level check that `withRequest` + Zod + serializer compose:

```ts
/** @vitest-environment node */
import { afterAll, expect, test, vi } from "vitest";
import { GET, POST } from "@/app/api/demands/route";
// withRouteTestDb() (@/test/route-db, plan-1a Task 11) packages the whole
// mock + lifecycle dance into two statements — the up-to-date example is
// src/app/api/guest-invites/__tests__/create.route.test.ts, ported to it.
vi.mock("@/server/db/client", async () =>
  (await import("@/test/route-db")).routeDbClientMock(),
);
const { db, asActor } = withRouteTestDb();
// asActor(user) → { cookie, headers, token, actor, run }; spread `headers`
// into the Request init, or use `run(() => service(...))` for a direct call.
```
Cases: no session → 401; bad body (`source` not an enum member) → 400 with `{ error: "invalid" }`; a valid guest create → 201 `{ id, ref }`; `GET` list returns an array of serialized rows (guest rows carry no `worth`). Task 3 and Task 4's route tests use the same `withRouteTestDb()` seam.

- [ ] **Step 2: Run them, verify they fail** — `pnpm test src/server/modules/demand src/app/api/demands` → FAIL (modules missing).

- [ ] **Step 3: Implement `serialize.ts`**

```ts
import type { $Enums } from "@prisma/client";
import { serializePick } from "@/server/policy/serialize";
import { type Actor } from "@/server/policy/actor";

export const DEMAND_GUEST_KEYS = [
  "id", "ref", "title", "problem", "source", "affectedService", "createdAt",
] as const;

export function guestStatusLabel(
  status: $Enums.DemandStatus,
  decision: $Enums.WorthDecision | null,
  rejectionReason: string | null,
): string {
  switch (status) {
    case "SUBMITTED":
    case "TRIAGING":
    case "WORTH_ASSESSED":
      return "In review";
    case "APPROVED":
      return decision === "PURSUE" ? "Approved" : "In review";
    case "CONVERTED":
      return "In progress"; // plan-03: follow the linked Change to "Delivered"
    case "REJECTED":
      return rejectionReason ? `Declined — ${rejectionReason}` : "Declined";
  }
}

type DemandWithWorth = { /* Demand + worth: WorthAssessment | null + client: { name: string } | null */ [k: string]: unknown };

export function serializeDemand(actor: Actor, row: DemandWithWorth): Record<string, unknown> {
  return serializePick(actor, row as Record<string, unknown>, {
    guestKeys: DEMAND_GUEST_KEYS,
    guestTransform: (r) => ({
      status: guestStatusLabel(
        r.status as $Enums.DemandStatus,
        (r.worth as { decision?: $Enums.WorthDecision } | null)?.decision ?? null,
        (r.rejectionReason as string | null) ?? null,
      ),
      clientName: (r.client as { name: string } | null)?.name ?? null,
    }),
  });
}
```
An internal reader gets the full row (`serializePick` passes it through — there is no `internalOmit` here). A guest gets only `DEMAND_GUEST_KEYS` plus the `guestTransform` output: `worth`, `submittedById`, `decidedAt`, and any internal column added to the row later are hidden **by omission from the allowlist**, not by an active strip — so a new column cannot leak, and there is no `assertNoInternalKeys` to keep in sync.
(There is no `rejectionReason` column on `Demand` in the schema — Task 4 adds it via a migration, or reuses `WorthAssessment.decisionNote` when `decision = DROP`. **Ruling:** add `Demand.rejectionReason String?` in Task 4's migration; `serializeDemand`'s `guestTransform` reads it. Until Task 4, it reads as `undefined`.)

- [ ] **Step 4: Implement `service.ts` — create / list / get**

- `createDemand`: `authorize(actor, "demand.create", { type: "demand" })` (always allows — kept for symmetry + the audit trail of "who was allowed"). `const ref = await nextRef(tx, "DEM");` `tx.demand.create({ data: { ref, title, problem, source: input.source, status: "SUBMITTED", submittedById: actor.id, clientId: isInternal(actor) ? null : actor.clientId, affectedService: input.affectedService ?? null } })`. `writeAudit(tx, { actorId: actor.id, action: "demand.create", subjectType: "Demand", subjectId: demand.id, payload: { source: input.source, byGuest: !isInternal(actor) } })`. If `!isInternal(actor)`: `emitNotification(tx, { recipients: { audience: "ALL_INTERNAL" }, kind: "ASSIGNED", subjectType: "Demand", subjectId: demand.id, summary: `New client demand: ${title}`, excludeActorId: actor.id })`. Return `{ id, ref }`.
- `listDemands`: build a `where` from `filters` (`status`, `source`, `mine ? { submittedById: actor.id } : {}`) spread with `...scopeToClient(actor)`. `prisma.demand.findMany({ where, include: { worth: true, client: { select: { name: true } } }, orderBy: { createdAt: "desc" } })`. Map through `serializeDemand(actor, …)`.
- `getDemandForActor`: `const row = await prisma.demand.findUnique({ where: { id }, include: { worth: true, client: { select: { name: true } } } });` `assertVisibleToGuest(actor, row)` (throws `NotFoundError` for a guest cross-client or a missing row; internal actors pass but a `null` row must still 404 — add `if (!row) throw new NotFoundError("not found")` before the assert). `authorize(actor, "demand.view", { type: "demand", id, clientId: row.clientId })`. Return `serializeDemand(actor, row)`.

- [ ] **Step 5: Implement the routes**

`src/app/api/demands/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createDemandBody, listDemandsQuery } from "@/lib/api/schemas/demands";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { createDemand, listDemands } from "@/server/modules/demand/service";
import { runInTransaction } from "@/server/db/tx";

export const POST = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  const input = createDemandBody.parse(await req.json().catch(() => null));
  const out = await runInTransaction((tx) => createDemand(actor, tx, input));
  return NextResponse.json(out, { status: 201 });
});

export const GET = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  const filters = listDemandsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return NextResponse.json({ demands: await listDemands(actor, filters) });
});
```
`src/app/api/demands/[id]/route.ts`: `GET` → `getActor()` → `getDemandForActor(actor, params.id)` → `NextResponse.json(demand)`. (Next 15: `context.params` is a `Promise` — `const { id } = await context.params`.)

`src/lib/api/schemas/demands.ts`:
```ts
import { z } from "zod";
export const createDemandBody = z.object({
  title: z.string().trim().min(1).max(200),
  problem: z.string().trim().min(1).max(5000),
  source: z.enum(["CLIENT", "INCIDENT", "TECH_DEBT", "COMPLIANCE", "OPPORTUNITY", "INTERNAL"]),
  affectedService: z.string().trim().max(200).optional(),
});
export const listDemandsQuery = z.object({
  status: z.enum(["SUBMITTED","TRIAGING","WORTH_ASSESSED","APPROVED","REJECTED","CONVERTED"]).optional(),
  source: z.enum(["CLIENT","INCIDENT","TECH_DEBT","COMPLIANCE","OPPORTUNITY","INTERNAL"]).optional(),
  mine: z.coerce.boolean().optional(),
});
```
(Enum arrays duplicated from the schema — acceptable; a shared `src/lib/enums.ts` re-exporting `$Enums` value tuples is a nice-to-have, not required.)

- [ ] **Step 6: Run the tests, verify they pass** — PASS. Full gate green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/api/schemas/demands.ts src/server/modules/demand/ src/app/api/demands/
git commit -m "feat: demand create/list/get — service, serializer, routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Demand state machine + triage & scoring

**Files:**
- Create: `src/server/modules/demand/state.ts`, `src/app/api/demands/[id]/triage/route.ts`, `src/app/api/demands/[id]/value/route.ts`, `src/app/api/demands/[id]/effort/route.ts`
- Modify: `src/server/modules/demand/service.ts` (add `startTriage`, `scoreValue`, `scoreEffort`), `src/lib/api/schemas/demands.ts` (add the bodies)
- Test: `src/server/modules/demand/__tests__/state.test.ts`, extend `service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // state.ts
  export const DEMAND_TRANSITIONS: Record<$Enums.DemandStatus, readonly $Enums.DemandStatus[]>;
  export function assertTransition(from: $Enums.DemandStatus, to: $Enums.DemandStatus): void; // throws ForbiddenError
  export function worthComplete(w: { businessValue: string | null; effort: $Enums.Effort | null; costOfDelay: string | null }): boolean;

  // service.ts additions
  export function startTriage(actor: Actor, tx: PrismaTransaction, id: string): Promise<void>;
  export function scoreValue(actor: Actor, tx: PrismaTransaction, id: string, input: { businessValue: string; valueScore?: number }): Promise<void>;
  export function scoreEffort(actor: Actor, tx: PrismaTransaction, id: string, input: { effort: $Enums.Effort; feasibility?: string }): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

`state.test.ts`:
```ts
import { expect, test } from "vitest";
import { assertTransition, worthComplete } from "@/server/modules/demand/state";
import { ForbiddenError } from "@/server/policy/errors";

test("legal and illegal transitions", () => {
  expect(() => assertTransition("SUBMITTED", "TRIAGING")).not.toThrow();
  expect(() => assertTransition("TRIAGING", "WORTH_ASSESSED")).not.toThrow();
  expect(() => assertTransition("SUBMITTED", "APPROVED")).toThrow(ForbiddenError);
  expect(() => assertTransition("CONVERTED", "TRIAGING")).toThrow(ForbiddenError);
});

test("worthComplete needs value narrative, effort, and cost of delay", () => {
  expect(worthComplete({ businessValue: "v", effort: "M", costOfDelay: "c" })).toBe(true);
  expect(worthComplete({ businessValue: "v", effort: null, costOfDelay: "c" })).toBe(false);
});
```

Extend `service.test.ts`:
```ts
test("startTriage moves SUBMITTED → TRIAGING and creates an empty WorthAssessment", async () => { /* seed internal actor + a demand; startTriage; assert status + worth row exists + demand.triage_started audit */ });

test("only a BUSINESS_APPROVER may score value; only a TECHNICAL_APPROVER may score effort", async () => {
  // a DEVELOPER-only actor → scoreValue rejects with ForbiddenError; a BUSINESS_APPROVER succeeds.
  // the CEO (BUSINESS_APPROVER, no TECHNICAL_APPROVER) → scoreEffort rejects.
});

test("scoring the last of {value, effort, costOfDelay} flips the demand to WORTH_ASSESSED", async () => {
  // seed a TRIAGING demand with businessValue + costOfDelay already set; scoreEffort; assert status === "WORTH_ASSESSED" + demand.effort_scored audit.
});

test("value scored notifies TECHNICAL_APPROVER hat holders; effort scored notifies BUSINESS_APPROVER hat holders", async () => { /* per spec §7 */ });
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `state.ts`**

```ts
import type { $Enums } from "@prisma/client";
import { ForbiddenError } from "@/server/policy/errors";

export const DEMAND_TRANSITIONS: Record<$Enums.DemandStatus, readonly $Enums.DemandStatus[]> = {
  SUBMITTED: ["TRIAGING"],
  TRIAGING: ["WORTH_ASSESSED"],
  WORTH_ASSESSED: ["APPROVED", "REJECTED"],
  APPROVED: ["WORTH_ASSESSED", "CONVERTED"], // re-decide a parked demand; convert lands in plan-03
  REJECTED: [],
  CONVERTED: [],
};

export function assertTransition(from: $Enums.DemandStatus, to: $Enums.DemandStatus): void {
  if (!DEMAND_TRANSITIONS[from].includes(to)) {
    throw new ForbiddenError(`illegal demand transition: ${from} → ${to}`);
  }
}

export function worthComplete(w: { businessValue: string | null; effort: $Enums.Effort | null; costOfDelay: string | null }): boolean {
  return w.businessValue != null && w.effort != null && w.costOfDelay != null;
}
```

- [ ] **Step 4: Implement the service functions** — each loads the demand (`tx.demand.findUnique({ where: { id }, include: { worth: true } })`, `NotFoundError` if missing), calls `authorize` with the right action + a hydrated subject `{ type: "demand", id, submittedById: row.submittedById, clientId: row.clientId, status: row.status }`, then:
  - `startTriage`: `assertTransition(row.status, "TRIAGING")`; `tx.demand.update({ where: { id }, data: { status: "TRIAGING" } })`; `tx.worthAssessment.upsert({ where: { demandId: id }, create: { demandId: id }, update: {} })`; `writeAudit(… "demand.triage_started" …)`; `emitNotification(… { audience: "ALL_INTERNAL" }, "STATUS_CHANGED", … excludeActorId: actor.id …)` — spec §7 says "the other internal user"; `ALL_INTERNAL` minus the actor is the 2-person-company reading of that.
  - `scoreValue`: `authorize(actor, "demand.score.value", subject)`; require `row.status === "TRIAGING"` (else `ForbiddenError("value can only be scored during triage")`); `tx.worthAssessment.update({ where: { demandId: id }, data: { businessValue: input.businessValue, valueScore: input.valueScore ?? null, valueScoredById: actor.id } })`; `writeAudit(… "demand.value_scored" …)`; then **maybe transition**: reload `worth`, if `worthComplete(worth)` → `assertTransition("TRIAGING","WORTH_ASSESSED")` + `tx.demand.update(status: "WORTH_ASSESSED")` + `writeAudit("demand.worth_assessed"?)` — no, spec §6 audit list has no `worth_assessed` event; the transition is implicit. Just flip the status. Notify `{ hat: "TECHNICAL_APPROVER" }`.
  - `scoreEffort`: mirror, `authorize(… "demand.score.effort" …)`, writes `effort` + `feasibility` + `effortScoredById`, `demand.effort_scored` audit, notify `{ hat: "BUSINESS_APPROVER" }`, same maybe-transition.
  - **Cost of delay**: spec §8.2 says "any internal user" edits it. Add a `setCostOfDelay(actor, tx, id, { costOfDelay })` here too (route `PATCH /api/demands/[id]/cost-of-delay` — add it), `authorize(actor, "demand.view", subject)` + `requireInternal` is enough (no dedicated action; a viewer who is internal may edit). Same maybe-transition. Audit `demand.cost_of_delay_set` (add to the spec's event list — a gap; note it).

- [ ] **Step 5: Implement the routes** — each `withRequest` → `getActor` → parse body → `runInTransaction((tx) => service…(actor, tx, id, body))` → `NextResponse.json({ ok: true })`. Schemas:
```ts
export const scoreValueBody = z.object({ businessValue: z.string().trim().min(1), valueScore: z.number().int().min(1).max(10).optional() });
export const scoreEffortBody = z.object({ effort: z.enum(["S","M","L"]), feasibility: z.string().trim().max(2000).optional() });
export const costOfDelayBody = z.object({ costOfDelay: z.string().trim().min(1).max(2000) });
```

- [ ] **Step 6: Run tests, verify pass. Full gate.**

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/demand/ src/app/api/demands/ src/lib/api/schemas/demands.ts
git commit -m "feat: demand triage and value/effort scoring with the worth-gate transition

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Demand decision, reject, SoD override

**Files:**
- Create: `src/app/api/demands/[id]/decision/route.ts`, `src/app/api/demands/[id]/reject/route.ts`, `prisma/migrations/<ts>_demand_rejection_reason/migration.sql`
- Modify: `prisma/schema.prisma` (`Demand.rejectionReason String?`), `src/server/modules/demand/service.ts` (`decideDemand`, `rejectDemand`), `src/lib/api/schemas/demands.ts`
- Test: extend `src/server/modules/demand/__tests__/service.test.ts`, `src/app/api/demands/__tests__/decision.route.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function decideDemand(actor: Actor, tx: PrismaTransaction, id: string, input: { decision: $Enums.WorthDecision; note?: string; overrideJustification?: string }): Promise<void>;
  export function rejectDemand(actor: Actor, tx: PrismaTransaction, id: string, input: { reason: string }): Promise<void>;
  ```
- Consumes: `requireAnyHat` (`@/server/policy/subjects/helpers`) for the override path; `SegregationError` (`@/server/policy/errors`).

- [ ] **Step 1: Add the migration** (spec 05 §migration discipline): `prisma migrate dev --create-only --name demand_rejection_reason`, edit `migration.sql` — prepend the reversibility comment `-- Down: ALTER TABLE "Demand" DROP COLUMN "rejectionReason";`, then `prisma migrate dev --name demand_rejection_reason` to apply + record the checksum of the final file. Add `rejectionReason String?` to `model Demand` in `schema.prisma` before the `--create-only` step.

- [ ] **Step 2: Write the failing tests** (extend `service.test.ts`)

```ts
test("a non-submitter approver decides: WORTH_ASSESSED → APPROVED, decision + note recorded, demand.decided audited, submitter notified", async () => {
  // seed a WORTH_ASSESSED demand submitted by a guest; a BUSINESS_APPROVER decides PURSUE.
  // assert status APPROVED, worth.decision PURSUE, decidedAt set, one demand.decided audit,
  // a STATUS_CHANGED notification to the guest submitter, and (guest submitter) an EmailOutbox row.
});

test("the submitter deciding their own demand → SegregationError('demand.decide.override')", async () => {
  // an INTERNAL user who is also the submitter and holds BUSINESS_APPROVER.
  await expect(ctx(() => db().$transaction((tx) => decideDemand(submitterActor, tx, id, { decision: "PURSUE" }))))
    .rejects.toMatchObject({ overrideAction: "demand.decide.override" });
});

test("the submitter with a >=20-char justification: decision recorded as an override, BOTH demand.decided and demand.decide.override audited", async () => {
  await ctx(() => db().$transaction((tx) => decideDemand(submitterActor, tx, id, { decision: "PARK", overrideJustification: "sole approver available this week; CTO on leave" })));
  const w = await db().worthAssessment.findUniqueOrThrow({ where: { demandId: id } });
  expect(w.isSingleApproverOverride).toBe(true);
  expect(w.decision).toBe("PARK");
  const actions = (await db().auditEvent.findMany({ where: { subjectId: id } })).map((a) => a.action);
  expect(actions).toEqual(expect.arrayContaining(["demand.decided", "demand.decide.override"]));
});

test("DROP decision → REJECTED; explicit /reject on a WORTH_ASSESSED demand → REJECTED with the reason, demand.rejected audited, submitter notified", async () => { /* … */ });

test("park then re-decide: APPROVED(PARK) → decideDemand(PURSUE) → APPROVED(PURSUE), one more demand.decided audit", async () => { /* re-decide is allowed */ });

test("a guest cannot decide or reject (ForbiddenError / 404)", async () => { /* … */ });
```

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Implement `decideDemand`**

```
load demand + worth; NotFoundError if missing.
subject = { type: "demand", id, submittedById: row.submittedById, clientId: row.clientId, status: row.status }.
const isSubmitter = actor.id === row.submittedById;
const override = typeof input.overrideJustification === "string" && input.overrideJustification.trim().length >= 20;

if (isSubmitter && override) {
  requireAnyHat(actor, ["BUSINESS_APPROVER", "TECHNICAL_APPROVER"]);   // hat check without SoD
} else {
  authorize(actor, "demand.decide", subject);   // throws SegregationError for the un-justified submitter
}

require row.status is WORTH_ASSESSED or (APPROVED and worth.decision === "PARK")  // else ForbiddenError
require worthComplete(worth)  // else ForbiddenError("worth assessment incomplete")

const target = input.decision === "DROP" ? "REJECTED" : "APPROVED";
assertTransition(row.status, target);

tx.worthAssessment.update({ where: { demandId: id }, data: {
  decision: input.decision, decisionNote: input.note ?? null, decidedById: actor.id,
  isSingleApproverOverride: isSubmitter && override,
  overrideJustification: isSubmitter && override ? input.overrideJustification!.trim() : null,
}});
tx.demand.update({ where: { id }, data: { status: target, decidedAt: new Date(),
  rejectionReason: input.decision === "DROP" ? (input.note ?? null) : null } });

writeAudit(tx, { actorId: actor.id, action: "demand.decided", subjectType: "Demand", subjectId: id,
  payload: { decision: input.decision, valueScore: worth.valueScore, effort: worth.effort } });
if (isSubmitter && override) {
  writeAudit(tx, { actorId: actor.id, action: "demand.decide.override", subjectType: "Demand", subjectId: id,
    payload: { justification: input.overrideJustification!.trim() } });
}

// notify the submitter — in-app always; email when the submitter is a guest
const submitter = await tx.user.findUnique({ where: { id: row.submittedById }, select: { kind: true, email: true } });
emitNotification(tx, {
  recipients: { userIds: [row.submittedById] },
  kind: "STATUS_CHANGED", subjectType: "Demand", subjectId: id,
  summary: `Your demand "${row.title}" was ${input.decision === "PURSUE" ? "approved" : input.decision === "PARK" ? "parked" : "declined"}`,
  email: submitter?.kind === "GUEST"
    ? { template: "demand_decided", payload: { ref: row.ref, status: guestStatusLabel(target, input.decision, input.note ?? null) } }
    : undefined,
});
```
Register a `demand_decided` email template in `src/server/modules/notify/templates/index.ts` (add `demand-decided.ts` next to `guest-invite.ts`; guest-safe copy, uses the §5 status words). Update `CONTRACTS.md` §3 template list.

- [ ] **Step 5: Implement `rejectDemand`** — `authorize(actor, "demand.reject", subject)`; allowed from `WORTH_ASSESSED` or `APPROVED(PARK)`; `assertTransition(row.status, "REJECTED")`; set `status: "REJECTED"`, `rejectionReason: input.reason`, `worth.decision: "DROP"` if a worth row exists; `writeAudit("demand.rejected", { reason })`; notify the submitter (`STATUS_CHANGED`, email if guest).

- [ ] **Step 6: Routes + schema**

```ts
export const decisionBody = z.object({
  decision: z.enum(["PURSUE", "PARK", "DROP"]),
  note: z.string().trim().max(2000).optional(),
  overrideJustification: z.string().trim().min(20).max(2000).optional(),
});
export const rejectBody = z.object({ reason: z.string().trim().min(1).max(2000) });
```
`decision/route.ts`: `POST` → `getActor` → parse → `runInTransaction((tx) => decideDemand(actor, tx, id, body))` → `NextResponse.json({ ok: true })`. A `SegregationError` propagates untouched to `mapError` → 409. `reject/route.ts` mirrors.

- [ ] **Step 7: Run tests + full gate + `pnpm exec dotenv -e .env -- prisma migrate status` clean.**

- [ ] **Step 8: Commit**

```bash
git add prisma/ src/server/modules/demand/ src/app/api/demands/ src/lib/api/schemas/demands.ts src/server/modules/notify/templates/ CONTRACTS.md
git commit -m "feat: demand worth decision, reject, and the single-approver override

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Demand register (`/demands`)

**Files:**
- Create: `src/app/(internal)/demands/page.tsx`, `src/app/(internal)/demands/DemandRegister.tsx`, `src/app/(internal)/demands/demands.module.css`
- Test: `src/app/(internal)/demands/__tests__/register.test.tsx`

**Interfaces:**
- Consumes: `DataTable` + `Column` (`@/components/DataTable`), `Pill` / `PriorityTag` / `RiskLabel` (`@/components/Pill`), the `GET /api/demands` route. `whoami()` for the shell (via the layout, already wired).
- Produces: the `/demands` route (list view). Task 7 adds `?view=board`; Task 6 adds the drawer.

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemandRegister } from "@/app/(internal)/demands/DemandRegister";

afterEach(cleanup);

const rows = [
  { id: "d1", ref: "DEM-0001", title: "Faster exports", source: "CLIENT", clientName: "Northwind", status: "TRIAGING", worth: { effort: "M", valueScore: 8 }, createdAt: new Date().toISOString() },
  { id: "d2", ref: "DEM-0002", title: "Audit log export", source: "COMPLIANCE", clientName: null, status: "APPROVED", worth: { effort: "S", valueScore: 5 }, createdAt: new Date().toISOString() },
];

test("renders a row per demand with ref, title, source, status", () => {
  render(<DemandRegister initialRows={rows} initialFilters={{}} />);
  expect(screen.getByText("DEM-0001")).toBeInTheDocument();
  expect(screen.getByText("Faster exports")).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
});

test("the status filter chip narrows the visible rows", async () => {
  render(<DemandRegister initialRows={rows} initialFilters={{}} />);
  await userEvent.click(screen.getByRole("button", { name: /approved/i }));
  expect(screen.queryByText("Faster exports")).not.toBeInTheDocument();
  expect(screen.getByText("Audit log export")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Build `page.tsx`** — `async` server component. `const sp = await searchParams;` parse `status/source/mine/view` with `listDemandsQuery`. Fetch server-side: call `listDemands(await getActor(), filters)` directly (a server component may import the service — it is not `api/**`; the Prisma boundary allows `src/server/**` imports from a server component as long as it does not import `@prisma/client` itself). If `view === "board"` render `<PrioritisationBoard rows={rows} />` (Task 7), else `<DemandRegister initialRows={rows} initialFilters={filters} />`.
  - **Ruling:** server components call services directly (no self-`fetch`). Client components call the route handlers.

- [ ] **Step 4: Build `DemandRegister`** — `"use client"`. State: `filters`, derived `visibleRows` (client-side filter over `initialRows` for snappy chips; a chip also pushes `router.push("/demands?status=…")` so a reload is stable). `DataTable` columns: `ref` (mono — **plain text, not wrapped in an element**, so the activator button gets a per-row name), `title`, `source` (a `Pill tone="info"`), `client` (`clientName ?? "—"` with an internal "raised by a client" marker), `status` (`Pill` — tone by status: APPROVED→ok, REJECTED→crit, else info), a value/effort mini-cell (`{worth?.effort ?? "—"} · {"●".repeat(scoreDots)}`), `age` (relative). Pass `onRowClick={(row) => setOpenId(row.id)}` and `label="Demand register"` per the amended `DataTableProps` contract (plan-1a Task 9): `onRowClick` is now optional, and when set, `DataTable` renders a visually-hidden activator `<button>` in the first cell (keyboard) plus a guarded `<tr onClick>` (mouse) — no `<tr role="button">`, no manual `stopPropagation`. `label` seeds the activator's accessible name (`"Open Demand register: DEM-0001"`). Then `{openId && <DemandDrawer id={openId} open onClose={() => setOpenId(null)} />}` (Task 6; until then a `// TODO(task-6)` no-op). Filter chips: a row of `<button>`s per status + a "raised by a client" toggle; sort `<select>` newest / oldest / "cost of delay" (cost-of-delay sort needs the field on the row — include `worth.costOfDelay` presence as a boolean tiebreak for v1, note the limitation).

- [ ] **Step 5: Run tests + full gate. Manually: `pnpm dev`, sign in as `admin@keel.local`, open `/demands` — the seeded demand(s) render.**

- [ ] **Step 6: Commit**

```bash
git add "src/app/(internal)/demands/"
git commit -m "feat: demand register — DataTable, filter chips, sort

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Demand drawer — read + activity + comments

**Files:**
- Create: `src/app/(internal)/demands/DemandDrawer.tsx`, `src/app/(internal)/demands/DemandDrawer.module.css`, `src/app/api/demands/[id]/comments/route.ts`
- Modify: `src/app/(internal)/demands/DemandRegister.tsx` (wire `onRowClick` → drawer)
- Test: `src/app/(internal)/demands/__tests__/drawer.test.tsx`, `src/app/api/demands/__tests__/comments.route.test.ts`

**Interfaces:**
- Consumes: `Drawer` (`@/components/Drawer`), `Panel`, `Timeline`, `LifecyclePips`, the `GET /api/demands/:id` route, a new `GET/POST /api/demands/:id/comments` route wrapping `listComments` / `addComment` (`@/server/modules/comment`). Audit events for the Timeline come from `GET /api/demands/:id` — extend `getDemandForActor` to include a recent-activity list.
- Produces: the read-only drawer. Task 7 adds the write actions.

- [ ] **Step 1: Extend `getDemandForActor`** to also return `activity`: `prisma.auditEvent.findMany({ where: { subjectType: "Demand", subjectId: id }, orderBy: { at: "asc" }, select: { action: true, at: true, actorId: true } })` mapped to `{ time, text }` for the `Timeline`. Use `auditActionLabel(action)` from `@/server/audit/labels` (plan-1a Task 13's shared registry) for the internal Timeline text — **not** a bespoke per-module map. For a guest, use `guestAuditActionLabel(action)` and drop any row where it returns `null` (internal-only actions self-hide — no allowlist needed on this end). The demand tasks must **append** their actions to `AUDIT_ACTION_LABELS` in `labels.ts` as each is introduced — `demand.create`, `demand.triage_started`, `demand.value_scored`, `demand.effort_scored`, `demand.cost_of_delay_set`, `demand.decided`, `demand.decide.override`, `demand.rejected` — and add `demand.create` ("Demand raised") + `demand.rejected` ("Declined") + `demand.decided` ("Decision recorded") to `guestAuditActionLabel`'s guest-visible set. The `activity` array is built by `getDemandForActor` after the per-actor `serializeDemand` (it is not a row column, so it never goes through the allowlist — the guest filtering is the `guestAuditActionLabel` null-drop above).

- [ ] **Step 2: Write the failing tests**

```tsx
/** @vitest-environment jsdom */
// mock fetch for GET /api/demands/d1 → a full serialized demand + activity; GET .../comments → []
test("opens with the demand's ref, title, problem, and a status pill", async () => { /* render <DemandDrawer id="d1" open onClose={fn} />; findByText("DEM-0001"), problem text, status */ });
test("renders the worth assessment panels read-only for a viewer without the hats", async () => { /* business value + effort shown as text, no inputs */ });
test("renders the activity timeline from the demand's events", async () => { /* Timeline items present */ });
test("posting a comment calls POST .../comments and prepends it", async () => { /* type + submit; fetch called; new comment shown */ });
```

- [ ] **Step 3: Build the comments route** — `src/app/api/demands/[id]/comments/route.ts`:
`addComment` / `listComments` (`@/server/modules/comment`) take one `CommentSubject` now (plan-1a Task 4) — `{ type: "Demand" | "Incident"; id; clientId: string | null }` — and call `requireOwnClientOr404(actor, subject.clientId)` **internally**, so the route no longer needs its own ownership check for comments (the `authorize(actor, "comment.create", …)` action check stays with the route). The route needs the demand's real `clientId` for the subject — the guest-serialized shape omits it, so the demand service exposes a tiny `demandClientId(id: string): Promise<string | null>` (a `select: { clientId: true }` read; keeps the Prisma boundary — the route imports the service, never `@/server/db/client`):
```ts
export const GET = withRequest(async (req, _ctx) => {
  const actor = await getActor();
  const { id } = await _ctx.params;
  await getDemandForActor(actor, id); // authorizes view / 404s for a guest cross-client
  const clientId = await demandClientId(id);
  return NextResponse.json({ comments: await listComments(actor, { type: "Demand", id, clientId }) });
});
export const POST = withRequest(async (req, _ctx) => {
  const actor = await getActor();
  const { id } = await _ctx.params;
  const { body, visibleToClient } = commentBody.parse(await req.json().catch(() => null));
  await getDemandForActor(actor, id); // 404s a guest cross-client
  const clientId = await demandClientId(id);
  authorize(actor, "comment.create", { type: "demand", id, clientId });
  await runInTransaction((tx) =>
    addComment(tx, { actor, subject: { type: "Demand", id, clientId }, body, visibleToClient }));
  return NextResponse.json({ comments: await listComments(actor, { type: "Demand", id, clientId }) }, { status: 201 });
});
```
  - **Ruling:** the POST response re-lists (`listComments`) rather than hand-serializing one row — `serializeComment` needs the author join.
  - `commentBody = z.object({ body: z.string().trim().min(1).max(5000), visibleToClient: z.boolean().optional() })`.

- [ ] **Step 4: Build `DemandDrawer`** — `"use client"`. `useEffect` on `open && id` → `fetch("/api/demands/" + id)` + `fetch("/api/demands/" + id + "/comments")`; loading + error states. Layout inside `<Drawer open onClose title={demand.title} idLabel={demand.ref}>`: a status `Pill`; a **Problem** `Panel` (the `problem` text); a **Worth assessment** section — two `Panel`s side by side (Business value: `businessValue` text + `valueScore`/10 if set; Effort & feasibility: `effort` + `feasibility` text) — **read-only in this task**; **Cost of delay** `Panel` (text); **Activity** `Panel` with `<Timeline items={activity} />`; **Comments** `Panel` — a list of `SerializedComment` + a `<textarea>` + a "visible to client" checkbox (internal only) + submit → POST → replace list. Style with `DemandDrawer.module.css`.

- [ ] **Step 5: Wire the register** — `DemandRegister` `onRowClick={(row) => setOpenId(row.id)}`, render `{openId && <DemandDrawer id={openId} open onClose={() => setOpenId(null)} />}`.

- [ ] **Step 6: Run tests + full gate + manual check (open a demand from the register).**

- [ ] **Step 7: Commit**

```bash
git add "src/app/(internal)/demands/" src/app/api/demands/ src/server/modules/demand/
git commit -m "feat: demand drawer — problem, worth panels (read), activity, comments

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Demand drawer — write actions (scoring, decision, override, convert-stub)

**Files:**
- Create: `src/app/(internal)/demands/OverrideDialog.tsx`
- Modify: `src/app/(internal)/demands/DemandDrawer.tsx`, `DemandDrawer.module.css`
- Test: extend `src/app/(internal)/demands/__tests__/drawer.test.tsx`

**Interfaces:**
- Consumes: the `POST /:id/triage`, `PATCH /:id/value`, `PATCH /:id/effort`, `PATCH /:id/cost-of-delay`, `POST /:id/decision`, `POST /:id/reject` routes. `whoami()` (passed as a prop from the page, or fetched) to know the current actor's hats.
- Produces: the fully interactive drawer. The Convert button is a disabled stub with `title="Available once the change module ships (plan-03)"`.

- [ ] **Step 1: Write the failing tests** (extend `drawer.test.tsx`)

```tsx
test("a TRIAGING demand with a BUSINESS_APPROVER viewer: the business-value field is editable and saves via PATCH /value", async () => { /* mock whoami hats: ["BUSINESS_APPROVER"]; type a narrative + score; save; assert fetch PATCH .../value; re-fetch called */ });
test("the effort field is read-only for a viewer without TECHNICAL_APPROVER", async () => { /* … */ });
test("Decision buttons are disabled until businessValue, effort, and cost of delay are all present", async () => { /* … */ });
test("when the viewer is the submitter, clicking Pursue opens the override dialog; submitting a >=20-char justification calls POST /decision with overrideJustification", async () => { /* … */ });
test("a 409 segregation response from /decision (no justification) opens the override dialog", async () => { /* mock POST /decision → 409 { error: 'segregation', overrideAction: 'demand.decide.override' }; assert dialog appears */ });
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Build `OverrideDialog`** — a small modal (`Drawer` with a narrow width, or an inline `<dialog>`): a `<textarea>` (min 20 chars, live counter), Cancel / Confirm. `onConfirm(justification)` → parent re-issues the decision request with `overrideJustification`.

- [ ] **Step 4: Make the drawer panels interactive** — gate each editable control on `status === "TRIAGING"` AND the viewer's hat (`hats.includes("BUSINESS_APPROVER")` for value, `"TECHNICAL_APPROVER"` for effort; either hat for cost of delay + decision). Save buttons call the routes, then re-run the two `fetch`es (source of truth is the server). Decision row: three buttons (`Pursue`/`Park`/`Drop`), `disabled` unless `worthComplete`; on click → `POST /decision`; a `409` with `overrideAction` → open `OverrideDialog`; on dialog confirm → retry with `overrideJustification`. A `Reject` button → a reason prompt → `POST /reject`. Convert button: rendered `disabled` when `status === "APPROVED" && decision === "PURSUE"`, with the plan-03 tooltip.

- [ ] **Step 5: Run tests + full gate + manual: as `admin@keel.local` (holds all four hats), triage a demand, score both sides, set cost of delay, decide — watch the status pill and activity update.**

- [ ] **Step 6: Commit**

```bash
git add "src/app/(internal)/demands/"
git commit -m "feat: demand drawer write actions — scoring, decision, SoD override dialog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Prioritisation board (`/demands?view=board`)

**Files:**
- Create: `src/app/(internal)/demands/PrioritisationBoard.tsx`, `PrioritisationBoard.module.css`
- Modify: `src/app/(internal)/demands/page.tsx` (branch on `view === "board"`), `DemandRegister.tsx` (a list/board toggle)
- Test: `src/app/(internal)/demands/__tests__/board.test.tsx`

**Interfaces:**
- Consumes: the same serialized rows as the register (`worth.effort`, `worth.valueScore`).
- Produces: the read-only value×effort grid.

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
test("places each demand in the cell for its effort column and value-score band", () => {
  const rows = [
    { id: "d1", ref: "DEM-0001", title: "A", worth: { effort: "S", valueScore: 9 }, status: "TRIAGING" },
    { id: "d2", ref: "DEM-0002", title: "B", worth: { effort: "L", valueScore: 3 }, status: "TRIAGING" },
    { id: "d3", ref: "DEM-0003", title: "C", worth: { effort: null, valueScore: null }, status: "SUBMITTED" },
  ];
  render(<PrioritisationBoard rows={rows} />);
  // A in (S, high); B in (L, low); C in an "unscored" tray
  expect(within(screen.getByTestId("cell-S-high")).getByText("A")).toBeInTheDocument();
  expect(within(screen.getByTestId("cell-L-low")).getByText("B")).toBeInTheDocument();
  expect(within(screen.getByTestId("tray-unscored")).getByText("C")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Build the board** — a CSS grid: 3 effort columns (`S`/`M`/`L`) × 3 value rows (`high` ≥ 7, `medium` 4–6, `low` ≤ 3). Each cell `data-testid={`cell-${effort}-${band}`}` holds cards (`ref` + `title`, clickable → drawer, reusing the register's `openId` mechanism — lift `openId` to `page.tsx`? No: keep the board and register separate mounts, each renders its own `<DemandDrawer>`). Unscored demands (no `effort` or no `valueScore`) go in a bottom "Not yet scored" tray. Read-only — a caption: "Ranking aid. Decisions happen in the drawer."

- [ ] **Step 4: Run tests + full gate + manual toggle between list and board.**

- [ ] **Step 5: Commit**

```bash
git add "src/app/(internal)/demands/"
git commit -m "feat: demand prioritisation board — value x effort read view

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Guest portal — demand list & detail

**Files:**
- Create: `src/app/portal/demands/page.tsx`, `src/app/portal/demands/[id]/page.tsx`, `src/app/portal/demands/PortalDemandList.tsx`, `src/app/portal/demands/PortalDemandDetail.tsx`, `src/app/portal/demands/portal-demands.module.css`, `src/app/portal/page.tsx` (a portal home that links to `/portal/demands`)
- Test: `src/app/portal/demands/__tests__/portal.test.tsx`, extend `src/app/api/demands/__tests__/demands.route.test.ts` with guest cases

**Interfaces:**
- Consumes: `listDemands` / `getDemandForActor` (already guest-aware), the comments route (guest may comment). `guestStatusLabel`.
- Produces: the guest-facing demand pages. plan-04 folds these into the portal shell + adds incidents.

- [ ] **Step 1: Write the failing tests**

```tsx
/** @vitest-environment jsdom */
test("the list shows plain-word statuses and never an internal ref format the guest shouldn't see", async () => {
  // mock GET /api/demands (guest) → [{ ref: "DEM-0001", title: "Faster exports", status: "In review", clientName: "Northwind" }]
  render(<PortalDemandList rows={rows} />);
  expect(screen.getByText("In review")).toBeInTheDocument();
  expect(screen.queryByText(/TRIAGING/)).not.toBeInTheDocument();
});
test("detail shows the problem, the plain-word status, the activity in guest terms, and a comment box", async () => { /* … */ });
test("a guest comment posts with no visible-to-client toggle (always client-visible)", async () => { /* assert the checkbox is absent; POST body has no visibleToClient or it is ignored server-side */ });
```
Route-level (extend `demands.route.test.ts`, node env): a guest `GET /api/demands` response contains no `worth`, `submittedById`, `valueScore`; a guest `GET /api/demands/:id` for another client's demand → 404 (not 403).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Build the pages** — `portal/demands/page.tsx` (`async` server component): `const actor = await getActor()` (layout already guaranteed a guest); `const rows = await listDemands(actor, {})`; `<PortalDemandList rows={rows} />` — a simple card/table list, columns: your ref (or just the title + date — decide whether guests see `DEM-0001`; **ruling:** yes, the ref is fine, it is not sensitive), title, status (plain words), date. Row → `/portal/demands/[id]`.
  `portal/demands/[id]/page.tsx`: `const demand = await getDemandForActor(actor, id)` (404s appropriately); render `<PortalDemandDetail demand={demand} />` — title, status, the problem text, a guest-safe activity `Timeline`, and a comments block (reuse a shared `CommentThread` component if worth extracting — a `"use client"` island that GETs/POSTs `/api/demands/:id/comments`; no visible-to-client toggle for guests).
  `portal/page.tsx`: a minimal landing — "Your requests" linking to `/portal/demands`.

- [ ] **Step 4: Run tests + full gate. Manual: redeem the seeded invite (or use a seeded guest), sign in, open `/portal/demands`.**

- [ ] **Step 5: Commit**

```bash
git add src/app/portal/
git commit -m "feat: guest portal — demand list and detail in plain-word status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Integration pass & definition-of-done

**Files:**
- Create: `src/server/modules/demand/__tests__/lifecycle.integration.test.ts`
- Modify: `prisma/seed.ts` (add a demo client, a demo guest, and 2–3 demands across states — dev-only, behind a `NODE_ENV !== "production"` guard or a `--demo` flag)
- Test: the integration test above

**Interfaces:** none new — this task only exercises what Tasks 1–9 built.

- [ ] **Step 1: Write the lifecycle integration test** — one test, the full spec §10 path minus convert:

```ts
test("a guest demand goes intake → triage → scored → decided, audited at every step, guest sees plain words throughout", async () => {
  // seed client + guest + a CEO (BUSINESS_APPROVER) + a CTO (TECHNICAL_APPROVER), all distinct users.
  // 1. guest createDemand → status SUBMITTED, guestStatusLabel = "In review", ALL_INTERNAL notified.
  // 2. CEO startTriage → TRIAGING.
  // 3. CEO scoreValue, CTO scoreEffort, CEO setCostOfDelay → status flips to WORTH_ASSESSED on the last one.
  // 4. CTO decideDemand PURSUE (CTO is not the submitter) → APPROVED, worth.decision PURSUE, submitter notified + EmailOutbox row.
  // assert: audit actions in order == ["demand.create","demand.triage_started","demand.value_scored","demand.effort_scored","demand.cost_of_delay_set","demand.decided"];
  // assert: Object.keys(serializeDemand(guestActor, final)) === [...DEMAND_GUEST_KEYS, "status", "clientName"], status "Approved".
});

test("SoD: the CEO both submits and (as sole approver) decides — override required, justified, and both audit events present", async () => { /* … */ });
```

- [ ] **Step 2: Run it, watch it fail on the first missing wiring, fix, repeat until green.** (If everything from Tasks 1–9 is correct it may pass first try — that is fine, it is a regression anchor.)

- [ ] **Step 3: Extend `prisma/seed.ts`** — it already exists (plan-1a Task 10): idempotent `admin@keel.local` (4 hats) + `Client` "Northwind Traders". This task only **adds** a `seedDemoDemands()` that **composes** with that — do not re-create the admin or a second "Northwind Traders" (`Client.name` is `@unique` now — a bare `create` with the same name throws `P2002`; look the existing one up by name, or `upsert`). Add: a `GUEST` user `guest@northwind.example` (`upsert` on email; password `Keel-guest-2026` via `hashPassword`; `clientId` = the Northwind client's id), `ceo@keel.local` + `cto@keel.local` if absent, and demands one `SUBMITTED` / one `TRIAGING` with a partial worth / one `APPROVED (PURSUE)` (`upsert` on `ref` — allocate fixed demo refs like `DEM-9001..9003` so re-running the seed is a no-op). Wire `seedDemoDemands()` into the existing `main()` behind a `NODE_ENV !== "production"` guard.

- [ ] **Step 4: Run `pnpm db:reset` (dev) then `pnpm seed`; `pnpm dev`; walk the DoD checklist manually:**
  - [ ] sign in as `guest@northwind.example` → `/portal/demands` shows their demands in plain words
  - [ ] sign in as `admin@keel.local` → `/demands` register + board both render
  - [ ] open a `SUBMITTED` demand → triage → score → decide; status pill + activity update live
  - [ ] the guest, on reload, sees "Approved"
  - [ ] `GET /api/demands` as the guest (curl with their cookie) returns no internal keys
  - [ ] every step produced an `AuditEvent` (check the DB or a `/dev` audit peek if one exists)

- [ ] **Step 5: Full gate + coverage** — `pnpm test` green; `pnpm exec vitest run --coverage` and record the demand-module line/branch numbers in the commit body (spec §9's "enforced coverage threshold" is a CI gate defined in spec 08 / plan-08 — here, just report the numbers and ensure every §9 bullet has a test).

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/demand/__tests__/ prisma/seed.ts
git commit -m "test: demand lifecycle integration + demo seed data

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Definition of done (plan-01)

- A demand can be submitted by a seeded guest, appears in the internal register and the guest portal.
- CEO + CTO can triage it, score value and effort, set cost of delay, and record a `pursue` / `park` / `drop` decision; illegal transitions and incomplete-worth decisions are rejected.
- The submitter deciding their own demand requires a ≥20-char justification, recorded as an override with its own audit event.
- The guest sees the status in plain words at every step and never receives an internal-only field.
- Every state change writes exactly its audit event; the notification matrix in spec §7 fires.
- `/login` works; an authed internal user lands on `/demands`, a guest on `/portal`.
- **Deferred to plan-03:** `POST /api/demands/:id/convert`, the `demand.converted` event, the drawer's Convert action, and the mandated conversion-path idempotency tests.

---

## Self-review notes

- **Spec §4 `/triage` "starts triage (→ triaging)"** — Task 3 `startTriage`. ✓
- **Spec §4 guest sees only create + list + get + comments** — enforced by `authorize` (`demand.score.*` / `demand.decide` / `demand.reject` all `requireInternal` via `requireHat`/`requireAnyHat`) and `scopeToClient` on the list. Task 2 + Task 9 route tests. ✓
- **Spec §5 internal-only fields for demand** — an **allowlist** now (`DEMAND_GUEST_KEYS` + `serializePick`, plan-1a Task 3), not a denylist. A guest gets exactly `["id","ref","title","problem","source","affectedService","createdAt"]` + the `guestTransform` (`status`, `clientName`). The spec's internal-only list (`worthAssessment, affectedServiceInternalNote, decidedById, scorer ids`) is covered by omission: `worth` (and everything inside it — `decidedById`, scorer ids) is simply absent from `guestKeys`. `affectedServiceInternalNote` has no column yet → v1 gap (only `affectedService`, guest-visible per §8.1). The allowlist means a column added to `Demand` later cannot leak to guests until deliberately added to `DEMAND_GUEST_KEYS`. ✓ with a noted gap.
- **Spec §5 guest status mapping** — `guestStatusLabel` covers every `DemandStatus`; `CONVERTED → "In progress"` then "follows the linked Change to Delivered" is a plan-03 follow-up (commented). ✓
- **Spec §6 audit events** — `demand.create` (T2), `demand.triage_started` (T3), `demand.value_scored` / `demand.effort_scored` (T3), `demand.decided` (T4), `demand.decide.override` (T4), `demand.rejected` (T4). `demand.converted` → plan-03. **Added beyond the spec:** `demand.cost_of_delay_set` (T3) — the spec omits an event for it though §8.2 makes it an editable field; flag for spec reconciliation. ✓
- **Spec §7 notifications** — every row mapped to an `emitNotification` call in T2–T4; guest-submitter emails via a new `demand_decided` template (T4). ✓
- **Spec §8.1 register columns** — T5 `DataTable` columns. ✓ **§8.2 drawer** — T6 (read) + T7 (write). ✓ **§8.3 board** — T8. ✓
- **Spec §9 test plan** — service transitions + guards (T3, T4), RBAC (T2–T4 + route tests), SoD (T4), serializer (T2), audit-per-transition (every task), API Zod shapes + 404-vs-403 (T2, T9). Conversion-path tests → plan-03. ✓
- **Type consistency** — `serializeDemand` / `guestStatusLabel` signatures identical across T2, T6, T9. `decideDemand` input shape identical in T4 and T7's fetch calls and T10's integration test. `DemandWithWorth` include shape (`worth`, `client: { name }`) identical in T2, T3, T6. ✓
- **Placeholder scan** — no "TBD"/"handle edge cases"/"similar to Task N"; every code step has real code or a precise prose algorithm with the exact Prisma calls; test steps have real assertions (a few drawer tests are described as prose with the exact mock/assert named — acceptable per the plan-00 precedent, the implementer writes the bodies from the named cases). ✓
