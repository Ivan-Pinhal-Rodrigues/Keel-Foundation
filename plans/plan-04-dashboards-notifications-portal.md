# Dashboards + In-App Notifications + Portal Shell — Implementation Plan (Phase 1, plan-04)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the in-app notification surface (bell + `/notifications` + read API), the internal Overview dashboard (tiles + my-queue + approvals + activity feed + demand funnel + scheduled windows + email-delivery panel), and the real guest portal shell (client org name + bell + account menu + unified Submit page).

**Architecture:** Three interlocking pieces, built notifications-first because the bell is the shared dependency. The `notify` module gains a read side (`listNotifications` / `unreadCount` / `markRead`) alongside its existing write side (`emitNotification` / the outbox worker), exposed through `GET /api/notifications` + `POST /api/notifications/read`. The dashboard owns **no tables** — a new `overview` service composes each module's published read function into one `GET /api/overview` payload, and the `/overview` page renders it with the ported `Tile` / `Panel` / `ActivityFeed` components. The portal `(guest)/layout.tsx` is replaced with the spec-07 top bar. Every write still goes `route → withRequest → service(actor, tx, input) → authorize + domain write + writeAudit` inside `runInTransaction`; every read composes `authorize` (or a `userId = actor.id` scope) + a serializer.

**Tech Stack:** Next 15.5.24 App Router, React 19.1.0, TypeScript strict + `noUncheckedIndexedAccess`, Prisma 6.19.3 / PostgreSQL 16, Zod ^4.5.4, Vitest 3.2.7, `@testing-library/react` ^16, `@radix-ui/react-popover` (new — Radix is already a dependency, add the popover package), CSS Modules (no Tailwind), the ported `AppShell` / `Tile` / `Panel` / `ActivityFeed` / `Pill` / `Drawer` components.

**Spec:** [`specs/05-notifications.md`](specs/05-notifications.md) §7–§8 + [`specs/06-dashboards.md`](specs/06-dashboards.md) + [`specs/07-guest-portal.md`](specs/07-guest-portal.md) §3–§4. Cross-refs: [`specs/data-model.md`](specs/data-model.md) §"Support tables", [`../CONTRACTS.md`](../CONTRACTS.md) (the authoritative interface freeze — read it, plus `plans/plan-01-demand.md` … `plan-03-change-approvals.md` and the shipped `src/server/modules/**` + `src/app/(internal)/**` + `src/app/portal/**` as the working pattern, before Task 1).

## Global Constraints

- **Node 22 LTS** target. Local dev on Node 24 tolerated.
- **No Tailwind, no component library beyond the ported set + Radix primitives.** UI uses `src/components/**` + CSS Modules. Colours come only from `tokens.css` custom properties — never a raw hex in a component or module.
- **Prisma boundary (eslint-enforced):** `@prisma/client` **value** imports only under `src/server/db/**`. `src/server/**` elsewhere uses the `prisma` singleton from `@/server/db/client` and `import type` for Prisma types. `src/app/**` imports neither. Pure modules may `import type { $Enums }` and are safe to import from a client component.
- **Every `api/**` route handler is wrapped in `withRequest`** (`@/lib/api/with-request`). A dynamic segment uses the `export async function GET(req, { params })` form. Non-dynamic routes use `export const GET = withRequest(async (req) => …)`.
- **Every domain write runs inside `runInTransaction`** (`@/server/db/tx`) + `writeAudit` in the same `tx`. `markRead` writes `readAt` on `Notification` rows — it does **NOT** write an audit event (a per-user UI read is not a domain fact; `Notification` has `createdAt` only, no `updatedAt`, and no audit-writing convention for it).
- **Request bodies are parsed with a Zod schema** from `src/lib/api/schemas/<module>.ts`: `SCHEMA.parse(await req.json().catch(() => null))` → `ZodError` → `mapError` → 400. Zod 4 API: `z.enum([...])`. Query booleans use `z.enum(["true","false"]).optional().transform((v) => v === "true")` — **never** `z.coerce.boolean()` (plan-02's fix wave proved it broken).
- **Every `"use client"` component that talks to a route handler uses `apiFetch<T>`** from `@/lib/api/client` — never bare `fetch`, never `as any`. `apiFetch` throws `ApiError` on non-2xx (parsed body attached), returns `undefined` for 204 / empty.
- **`notification.view.own` is the only authz a notification read/write needs** (spec 05 §7): the rule is `() => {}` (already in the catalogue + `RULES`), and every notification query is scoped `where: { userId: actor.id }` with **no exceptions and no `scopeToClient`**. A user physically cannot address another user's rows — the `ids` in `POST /read` are filtered to `{ id: { in: ids }, userId: actor.id }`.
- **The Overview page and `GET /api/overview` are internal-only.** Guard: `requireInternal(actor)` (or `authorize(actor, "audit.view", { type: "audit" })` — spec 06 §3.3) **before** any read. A guest → 403 on the API, redirected to `/portal` on the page. The `overview` service does **no raw cross-module SQL** — it imports each module's `service.ts` read functions and composes in memory (architecture test: it imports no `@prisma/client`, no `@/server/db/client`, and calls no `.$queryRaw`).
- **Guest-facing copy stays plain-language** (specs 01 §5 / 02 §6): the portal shell and every portal component receive only client-safe strings from the serializer boundary — never a raw enum, an internal user name, a `ChangeStatus`, or "CAB"/"RFC"/"triaging".
- **TDD, RED first.** Each task: failing test → run → see it fail for the right reason → minimum implementation → pass → commit.
- **Tests hit the disposable-database harness:** `import { withTestDb } from "@/test/db"` → `const db = withTestDb();`. Open transactions in tests with `db().$transaction(...)`, **not** `runInTransaction`. Route-handler tests use `withRouteTestDb()` from `@/test/route-db`. Component tests: `/** @vitest-environment jsdom */` first line, then `afterEach(cleanup)`; Radix Popover/Dialog need `stubRadixEnv()` (`src/test/dom.ts`) in the test.
- **Test-actor literals** are typed `const x: Actor = {...}`, not `as const`. Seed helpers give every `Client` a unique `name`.
- **Caveman mode is for chat only.** Code, comments, commit messages, and this plan's prose stay in normal English. Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **`pnpm lint && pnpm typecheck && pnpm test && pnpm build` green before every commit.** `pnpm lint` includes `prettier --check .` — run `pnpm exec prettier --write` on new files first.
- **A known flake:** several jsdom component tests occasionally hit the 5s `testTimeout` under parallel load. If a component test times out, re-run `pnpm test` once; a pass on the re-run is the flake, not a regression. If you add many component tests and it worsens, note it for the whole-branch review (do not raise `testTimeout` yourself unless a task explicitly says to).
- **Enum casing:** Prisma enums are `SCREAMING_SNAKE` (`NotificationKind.APPROVAL_NEEDED`, `DemandStatus.TRIAGING`, `IncidentStatus.RESOLVED`). Specs write them lowercase — the code uses the enum values.
- **Do NOT stage `.claude/` or `.superpowers/`.** Do NOT run `pnpm dev` alongside `pnpm build`.

---

## Reconciliation rulings (specs 05/06/07 vs shipped Phase 0–plan-03)

1. **The modules have no `index.ts`.** Spec 06 §2's "imports only module `index.ts` files" was written before the code froze — every module exposes its reads from `service.ts`. The `overview` service imports `listDemands` / `countDemandsByStatus` from `@/server/modules/demand/service`, etc. The architecture test (spec 06 §5) checks the real invariant: `overview/service.ts` imports **no** `@prisma/client`, **no** `@/server/db/client`, and contains **no** `.$queryRaw` / `.$executeRaw`.

2. **Portal route paths are NOT renamed.** Spec 07 uses `/portal/requests` and `/portal/submit`; plan-01/02 shipped `/portal/demands` and `/portal/incidents` (+ tests reference them). Ruling: keep the shipped URLs. The portal **nav labels** are "My requests" / "My incidents" / "Submit" (spec 07 §3) pointing at `/portal/demands` / `/portal/incidents` / `/portal/submit`. The URL-vs-label mismatch is cosmetic and not worth a redirect layer + a test migration.

3. **`/portal/submit` is a new two-tab page** (spec 07 §4.4) that **replaces** `/portal/incidents/new` (plan-02 shipped that as the interim "Report a problem" form). plan-02's `PortalIncidentForm` moves into the "Report a problem" tab; a new `PortalDemandForm` fills the "Request software" tab. Delete `src/app/portal/(guest)/incidents/new/` and repoint the layout nav.

4. **The unread-comment dot** (spec 07 §4.2/§4.3) is derived from **unread `COMMENTED` notifications** for the actor: `listNotifications(actor, { kind: "COMMENTED", unread: true })` → a `Set<string>` of `subjectId`. The portal list pages take that set and render a dot on matching cards. No new "last viewed" column.

5. **`markRead` writes no audit event** (Global Constraints) — `Notification` is per-user UI ephemera (`onDelete: Cascade`, `createdAt` only). It writes `readAt` via a plain `tx.notification.updateMany` scoped to `userId: actor.id`; it may run in a `runInTransaction` for consistency but needs no `runWithContext` (no `writeAudit`).

6. **`audit.recentEvents(limit)`** is a NEW read added to the audit module (`src/server/audit/read.ts`) — spec 06 §2 lists it as "added by spec 00's audit module" but it was never built. It is internal-only (`authorize(actor, "audit.view", { type: "audit" })` at the route; the function itself takes `limit` + an optional `client`). Returns `{ at, action, actorId, subjectType, subjectId }[]` newest-first, mapped through `auditActionLabel` for the feed.

7. **The Overview `myQueue` "next action is mine" for demands** (spec 06 §3.2/§3.3): a demand appears when the actor holds the hat for a **missing** worth score in the demand's current `TRIAGING` state — `BUSINESS_APPROVER` + `worth.valueScore == null`, or `TECHNICAL_APPROVER` + `worth.effort == null`. Plus every incident `assigneeId == actor.id` not `RESOLVED`/`CLOSED`, and every change `ownerId == actor.id` not `CLOSED`/`ROLLED_BACK`. Deep links: incident → `/incidents?open=<id>`, change → `/changes?open=<id>`, demand → `/demands?open=<id>` (the incident/change registers already read `?open`; **add `?open` reading to the demand register** in the task that needs it, mirroring `IncidentRegister`).

8. **`/overview` becomes the internal home.** `src/app/page.tsx` `redirect("/demands")` → `redirect("/overview")`; `src/app/login/page.tsx`'s post-auth internal redirect → `/overview`; `src/app/(internal)/layout.tsx` + `portal/(guest)/layout.tsx`'s `redirect("/demands")` for a wrong-kind actor → `/overview`; the `// TODO(plan-06)` markers are removed. The `(internal)` route-group layout stays the guard; `/overview` sits inside it.

9. **`GET /api/overview` revalidation** (spec 06 §4): the `/overview` page's client island refetches on window `focus` and every 60 s (a `setInterval` + a `focus` listener, both cleared on unmount). No SWR/react-query — a plain `useEffect` + `apiFetch`.

10. **Module locations:** `src/server/modules/notify/` (the read side lands here beside `emit.ts` / `worker.ts`), `src/server/modules/overview/`, `src/server/audit/read.ts`.

---

## File Structure

**Notifications — read side**

- `src/server/modules/notify/read.ts` — `listNotifications(actor, filters, client?)`, `unreadCount(actor, client?)`, `markRead(actor, input, client?)`, `serializeNotification(row)` (adds `href` — the deep-link target derived from `subjectType`/`subjectId`). All scoped `userId: actor.id`.
- `src/lib/api/schemas/notifications.ts` — `listNotificationsQuery` (`{ unread?, kind? }`), `markReadBody` (`{ ids?: string[] } | { all: true }` — a discriminated/`refine`d union).
- `src/app/api/notifications/route.ts` — `GET` (list + `unreadCount` in one payload).
- `src/app/api/notifications/read/route.ts` — `POST` (`markRead`).
- `src/components/NotificationBell/NotificationBell.tsx` + `index.ts` + `.module.css` — the Radix `Popover` bell. `"use client"`, `apiFetch`, poll every 60 s.
- `src/app/notifications/page.tsx` + `NotificationsList.tsx` + `.module.css` — the full `/notifications` page (outside `(internal)` so a guest can reach their own — see the task; **or** inside `(internal)` with a portal twin — the task picks). Filters: kind, read/unread.

**Dashboard read-API additions (one per module, batched into Task 6)**

- `src/server/modules/demand/service.ts` — add `countDemandsByStatus(client?)` → `Record<$Enums.DemandStatus, number>`.
- `src/server/modules/incident/service.ts` — add `listOverdueIncidents(client?)` → the overdue rows (derived-fresh, mirrors the `overdue` filter but recomputes).
- `src/server/modules/change/service.ts` — add `listScheduledWindows(client?)` → `{ id, ref, title, windowStart, windowEnd }[]` for `SCHEDULED` changes, date-ordered, next-14-days.
- `src/server/audit/read.ts` — `recentEvents(limit, client?)`.

**Overview**

- `src/server/modules/overview/service.ts` — `buildOverview(actor, client?)` composing everything.
- `src/lib/api/schemas/overview.ts` — the `overviewResponse` Zod schema.
- `src/app/api/overview/route.ts` — `GET`.
- `src/app/(internal)/overview/page.tsx` — server component; guard + `buildOverview` + render.
- `src/app/(internal)/overview/OverviewClient.tsx` — `"use client"`; the refetch-on-focus/interval island wrapping the panels.
- `src/app/(internal)/overview/panels/` — `MyQueuePanel.tsx`, `ApprovalsPanel.tsx`, `ActivityPanel.tsx`, `FunnelPanel.tsx`, `WindowsPanel.tsx`, `EmailDeliveryPanel.tsx`.
- `src/app/(internal)/overview/overview.module.css`.

**Portal shell**

- `src/app/portal/(guest)/layout.tsx` — replaced: the spec-07 top bar.
- `src/app/portal/(guest)/PortalTopBar.tsx` — `"use client"` (holds the bell + account menu).
- `src/app/portal/(guest)/submit/page.tsx` + `SubmitTabs.tsx` + `PortalDemandForm.tsx` + `submit.module.css` — the two-tab Submit page. `PortalIncidentForm` moves here from `incidents/new/`.
- Delete `src/app/portal/(guest)/incidents/new/`.

**Wiring**

- `src/app/(internal)/AppShellChrome.tsx` — add the `overview` NavItem (first) + mount `<NotificationBell />` in the topbar.
- `src/app/page.tsx`, `src/app/login/page.tsx`, `src/app/(internal)/layout.tsx` — repoint the internal home to `/overview` (ruling 8).
- `src/server/policy/actions.ts` / `authorize.ts` — **no change** (`notification.view.own` + `audit.view` already exist).
- `package.json` — add `@radix-ui/react-popover`.

**Tests** — colocated under each module's `__tests__/`, plus `src/server/modules/overview/__tests__/overview.integration.test.ts` and route/component tests.

---

## Task 1: Notification read service

**Files:**
- Create: `src/server/modules/notify/read.ts`
- Test: `src/server/modules/notify/__tests__/read.test.ts`

**Interfaces:**
- Consumes: `prisma` / `PrismaClient` (`import type`), `Actor` (`@/server/policy/actor`), `auditActionLabel` is NOT used here (notification `payload` already carries a rendered summary).
- Produces:
  ```ts
  import type { $Enums, PrismaClient } from "@prisma/client";
  import type { Actor } from "@/server/policy/actor";

  export type NotificationView = {
    id: string;
    kind: $Enums.NotificationKind;
    subjectType: string;
    subjectId: string;
    summary: string;       // from row.payload.summary (emitNotification writes { summary } — CONFIRM by reading emit.ts) or row.payload rendered
    href: string;          // the deep-link target, from hrefFor(subjectType, subjectId, actorKind)
    createdAt: string;     // ISO
    readAt: string | null; // ISO or null
  };

  export function hrefFor(subjectType: string, subjectId: string, actorKind: $Enums.UserKind): string;
  //   internal actor: Demand → /demands?open=<id>; Incident → /incidents?open=<id>; Change → /changes?open=<id>;
  //     ApprovalRequest → /approvals ; anything else → /overview
  //   guest actor: Demand/demand → /portal/demands/<id> ; Incident/incident → /portal/incidents/<id> ; else → /portal
  //   (subjectType arrives in mixed case across the codebase — "Demand" vs "demand" vs "Incident" vs "incident" vs "change";
  //    normalise with .toLowerCase() before matching.)

  export function listNotifications(
    actor: Actor,
    filters: { unread?: boolean; kind?: $Enums.NotificationKind },
    client?: PrismaClient,
  ): Promise<NotificationView[]>;
  //   where: { userId: actor.id, ...(filters.unread ? { readAt: null } : {}), ...(filters.kind ? { kind: filters.kind } : {}) }
  //   orderBy: { createdAt: "desc" }   take: 50

  export function unreadCount(actor: Actor, client?: PrismaClient): Promise<number>;
  //   client.notification.count({ where: { userId: actor.id, readAt: null } })

  export function markRead(
    actor: Actor,
    input: { ids: string[] } | { all: true },
    client?: PrismaClient,
  ): Promise<{ updated: number }>;
  //   const where = "all" in input
  //     ? { userId: actor.id, readAt: null }
  //     : { userId: actor.id, id: { in: input.ids }, readAt: null };
  //   const { count } = await client.notification.updateMany({ where, data: { readAt: new Date() } });
  //   return { updated: count };
  ```

- [ ] **Step 1: Read `src/server/modules/notify/emit.ts`** to confirm the `Notification.payload` shape — `emitNotification` writes `payload: Json` from the `summary` string (probably `{ summary }` or `{ title, link }`). `serializeNotification` reads whatever key holds the human sentence. Match it exactly.

- [ ] **Step 2: Write the failing tests** — `read.test.ts`:

```ts
import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { hrefFor, listNotifications, markRead, unreadCount } from "@/server/modules/notify/read";
import type { Actor } from "@/server/policy/actor";

const db = withTestDb();

async function seedUserWithNotes(kind: "INTERNAL" | "GUEST" = "INTERNAL") {
  const user = await db().user.create({
    data: { email: `n-${Math.random().toString(16).slice(2)}@k`, passwordHash: "x", displayName: "N", kind, hats: kind === "INTERNAL" ? ["DEVELOPER"] : [], clientId: null },
  });
  await db().notification.createMany({
    data: [
      { userId: user.id, kind: "ASSIGNED", subjectType: "Incident", subjectId: "i1", payload: { summary: "You were assigned INC-1" } },
      { userId: user.id, kind: "COMMENTED", subjectType: "Demand", subjectId: "d1", payload: { summary: "New comment on DEM-1" }, readAt: new Date() },
      { userId: user.id, kind: "APPROVAL_NEEDED", subjectType: "ApprovalRequest", subjectId: "r1", payload: { summary: "Approval needed on CHG-1" } },
    ],
  });
  return user;
}

test("listNotifications is scoped to the actor and newest-first; unread filter works", async () => {
  const me = await seedUserWithNotes();
  const other = await seedUserWithNotes();
  const actor: Actor = { id: me.id, kind: "INTERNAL", hats: ["DEVELOPER"], clientId: null };

  const all = await listNotifications(actor, {}, db());
  expect(all.map((n) => n.subjectId)).toEqual(["r1", "d1", "i1"]); // createdAt desc — d1 has readAt so still listed
  expect(all.every((n) => n.summary.length > 0)).toBe(true);
  expect(all.every((n) => n.href.startsWith("/"))).toBe(true);

  const unread = await listNotifications(actor, { unread: true }, db());
  expect(unread.map((n) => n.subjectId).sort()).toEqual(["i1", "r1"]);

  // never another user's rows
  const otherActor: Actor = { id: other.id, kind: "INTERNAL", hats: ["DEVELOPER"], clientId: null };
  const otherList = await listNotifications(otherActor, {}, db());
  expect(otherList.every((n) => all.find((a) => a.id === n.id) === undefined)).toBe(true);
});

test("unreadCount counts only the actor's unread rows", async () => {
  const me = await seedUserWithNotes();
  const actor: Actor = { id: me.id, kind: "INTERNAL", hats: [], clientId: null };
  expect(await unreadCount(actor, db())).toBe(2);
});

test("markRead({ ids }) marks only the actor's matching unread rows; markRead({ all }) clears the rest", async () => {
  const me = await seedUserWithNotes();
  const other = await seedUserWithNotes();
  const actor: Actor = { id: me.id, kind: "INTERNAL", hats: [], clientId: null };
  const otherActor: Actor = { id: other.id, kind: "INTERNAL", hats: [], clientId: null };

  const mine = await listNotifications(actor, { unread: true }, db());
  // try to mark one of the other user's ids too — must be a no-op for it
  const otherMine = await listNotifications(otherActor, { unread: true }, db());
  const r1 = await markRead(actor, { ids: [mine[0]!.id, otherMine[0]!.id] }, db());
  expect(r1.updated).toBe(1); // only the actor's own

  const r2 = await markRead(actor, { all: true }, db());
  expect(r2.updated).toBe(1);
  expect(await unreadCount(actor, db())).toBe(0);
  expect(await unreadCount(otherActor, db())).toBe(2); // untouched
});

test("hrefFor: internal vs guest deep links, case-insensitive subjectType", () => {
  expect(hrefFor("Incident", "i1", "INTERNAL")).toBe("/incidents?open=i1");
  expect(hrefFor("incident", "i1", "INTERNAL")).toBe("/incidents?open=i1");
  expect(hrefFor("Change", "c1", "INTERNAL")).toBe("/changes?open=c1");
  expect(hrefFor("ApprovalRequest", "r1", "INTERNAL")).toBe("/approvals");
  expect(hrefFor("Demand", "d1", "GUEST")).toBe("/portal/demands/d1");
  expect(hrefFor("Incident", "i1", "GUEST")).toBe("/portal/incidents/i1");
  expect(hrefFor("Change", "c1", "GUEST")).toBe("/portal"); // a guest never sees a change
});
```

- [ ] **Step 3: Run, verify fail** — `pnpm test src/server/modules/notify/__tests__/read` → FAIL (module missing).

- [ ] **Step 4: Implement `read.ts`** per the interface block + the confirmed `payload` shape.

- [ ] **Step 5: Run, verify pass. Full gate.**

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/notify/read.ts src/server/modules/notify/__tests__/read.test.ts
git commit -m "feat: notification read service — list, unread count, mark read

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Notification API routes

**Files:**
- Create: `src/lib/api/schemas/notifications.ts`, `src/app/api/notifications/route.ts`, `src/app/api/notifications/read/route.ts`
- Test: `src/app/api/notifications/__tests__/notifications.route.test.ts`

**Interfaces:**
- Consumes: `listNotifications` / `unreadCount` / `markRead` (`@/server/modules/notify/read`), `withRequest`, `getActor`, `authorize` (`notification.view.own` — the rule is `() => {}`, so this is a formality + the audit trail of "who was allowed"), `runInTransaction`.
- Produces:
  ```ts
  // GET /api/notifications?unread=true&kind=ASSIGNED
  //   → { notifications: NotificationView[], unreadCount: number }
  // POST /api/notifications/read   body { ids: string[] } | { all: true }
  //   → { updated: number }
  ```
  `src/lib/api/schemas/notifications.ts`:
  ```ts
  import { z } from "zod";
  const KINDS = ["ASSIGNED", "APPROVAL_NEEDED", "STATUS_CHANGED", "COMMENTED", "OVERDUE"] as const;
  export const listNotificationsQuery = z.object({
    unread: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
    kind: z.enum(KINDS).optional(),
  });
  export const markReadBody = z.union([
    z.object({ all: z.literal(true) }),
    z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }),
  ]);
  export type MarkReadBody = z.infer<typeof markReadBody>;
  ```

- [ ] **Step 1: Write the failing tests** — `notifications.route.test.ts` (mirror `src/app/api/demands/__tests__/demands.route.test.ts` — `withRouteTestDb`, `asActor`). Cases:
  - no session → 401
  - `GET` as an internal user → 200 `{ notifications: [...], unreadCount: n }`, all rows have `userId === actor.id` (seed some for another user, assert absent)
  - `GET ?unread=true` → only `readAt: null` rows
  - `GET ?kind=NONSENSE` → 400 `{ error: "invalid" }`
  - `POST /read { ids: [<one of my ids>, <another user's id>] }` → 200 `{ updated: 1 }` (the other user's id is a no-op)
  - `POST /read { all: true }` → clears all my unread
  - `POST /read {}` (neither `ids` nor `all`) → 400
  - a **guest** `GET /api/notifications` → 200 with the guest's own rows (a guest legitimately has notifications — the portal bell). **Not** 403.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement the routes.**

`src/app/api/notifications/route.ts`:
```ts
import { NextResponse } from "next/server";
import { listNotificationsQuery } from "@/lib/api/schemas/notifications";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { authorize } from "@/server/policy/authorize";
import { listNotifications, unreadCount } from "@/server/modules/notify/read";

export const GET = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  authorize(actor, "notification.view.own", { type: "none" });
  const filters = listNotificationsQuery.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  const [notifications, unread] = await Promise.all([
    listNotifications(actor, filters),
    unreadCount(actor),
  ]);
  return NextResponse.json({ notifications, unreadCount: unread });
});
```
`src/app/api/notifications/read/route.ts`: `POST` → `getActor` → `authorize(actor, "notification.view.own", { type: "none" })` → `markReadBody.parse(...)` → `runInTransaction((tx) => markRead(actor, body, tx))` → `NextResponse.json(result)`. (`markRead` accepts a `PrismaClient` — `runInTransaction`'s `tx` is `Prisma.TransactionClient`; widen `markRead`'s param to `PrismaClient | Prisma.TransactionClient` as plan-03 Task 7 did for `getApprovalState`, OR just call `markRead(actor, body)` with no tx since it is a single `updateMany` and needs no atomicity. **Ruling: no tx** — one statement, no audit, `markRead(actor, body)` direct.)

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/schemas/notifications.ts src/app/api/notifications/
git commit -m "feat: GET /api/notifications and POST /api/notifications/read

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `NotificationBell` component

**Files:**
- Modify: `package.json` (add `@radix-ui/react-popover`), then `pnpm install`
- Create: `src/components/NotificationBell/NotificationBell.tsx`, `index.ts`, `NotificationBell.module.css`
- Test: `src/components/NotificationBell/__tests__/notification-bell.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` / `ApiError` (`@/lib/api/client`), `@radix-ui/react-popover`, the shape `{ notifications: NotificationView[]; unreadCount: number }` from `GET /api/notifications`.
- Produces:
  ```ts
  export function NotificationBell(): ReactNode;
  //   "use client". On mount + every 60s + on window "focus": apiFetch<{ notifications; unreadCount }>("/api/notifications?unread=false").
  //   Renders a <button> with a bell icon and, when unreadCount > 0, a badge (cap the display at "9+").
  //   Radix <Popover>: on open, shows the 10 most recent (slice(0,10)) — each a <a href={n.href}> with the summary + a relative time;
  //   an unread row gets a dot / bolder weight. A "Mark all read" button → apiFetch("/api/notifications/read", { method: "POST", body: { all: true } }) then refetch.
  //   A "See all" link → /notifications. Empty state: "You're all caught up."
  //   All timers + the focus listener cleared on unmount.
  ```

- [ ] **Step 1: Add the dependency** — `package.json` `dependencies`: `"@radix-ui/react-popover": "^1.1.4"` (match the version range of the other `@radix-ui/*` entries — check `@radix-ui/react-dialog`'s version and mirror the major). `pnpm install`. Confirm the CSP allowlist is irrelevant here (this is an npm dep, bundled — not a CDN load).

- [ ] **Step 2: Write the failing test** — `notification-bell.test.tsx` (`/** @vitest-environment jsdom */`, mock `@/lib/api/client`'s `apiFetch`, call `stubRadixEnv()`). Cases:
  - renders a bell button; with `unreadCount: 3` shows "3"; with `unreadCount: 12` shows "9+"
  - opening the popover lists the (mocked) recent notifications with their summaries; each is an `<a>` with the right `href`
  - "Mark all read" calls `apiFetch` with `POST /api/notifications/read` body `{ all: true }` then re-fetches (assert 2+ GET calls)
  - empty notifications → "You're all caught up."

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Implement.** Use `useEffect` for the mount fetch + `setInterval(fetch, 60_000)` + `window.addEventListener("focus", fetch)`, all torn down in the cleanup. Radix `Popover.Root` / `Trigger` / `Portal` / `Content`. CSS Modules + tokens (the badge uses `--crit` / `--crit-wash`).

- [ ] **Step 5: Run, verify pass. Full gate.**

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/NotificationBell/
git commit -m "feat: NotificationBell component with unread badge and mark-all-read

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `/notifications` page + wire the bell into the internal shell

**Files:**
- Create: `src/app/notifications/page.tsx`, `src/app/notifications/NotificationsList.tsx`, `src/app/notifications/notifications.module.css`
- Modify: `src/app/(internal)/AppShellChrome.tsx` (mount `<NotificationBell />` in the topbar)
- Test: `src/app/notifications/__tests__/notifications.test.tsx`

**Interfaces:**
- `page.tsx` — server component; `getCurrentActor()` → `redirect("/login")` if null (a guest CAN reach `/notifications` — their own rows; do NOT `requireInternal`). `whoami()` for the display name. Render `<NotificationsList />` (a `"use client"` island that fetches `/api/notifications` with the kind + read/unread filters as local state).
- `NotificationsList` — `"use client"`; filter controls (a kind `<select>`, a read/unread toggle) drive `apiFetch("/api/notifications?" + params)`; each row is an `<a href={n.href}>` with kind pill + summary + relative time + a read/unread marker; a per-row "mark read" and a "mark all read". Empty state.
- `AppShellChrome` topbar: `topbar={<div className={styles.topbar}><NotificationBell /><LogoutButton /></div>}`.

- [ ] **Step 1: Write the failing test** — `notifications.test.tsx` (jsdom, mock `apiFetch`). Cases: renders a row per notification; the kind filter re-fetches with `?kind=…`; the unread toggle re-fetches with `?unread=true`; "mark all read" posts `{ all: true }` and re-fetches; empty state.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** the page, list, CSS, and the `AppShellChrome` topbar change.

- [ ] **Step 4: Run, verify pass. Full gate** (build compiles `/notifications`).

- [ ] **Step 5: Commit**

```bash
git add src/app/notifications/ "src/app/(internal)/AppShellChrome.tsx"
git commit -m "feat: /notifications page; NotificationBell in the internal topbar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Dashboard read-API additions

**Files:**
- Modify: `src/server/modules/demand/service.ts` (`countDemandsByStatus`), `src/server/modules/incident/service.ts` (`listOverdueIncidents`), `src/server/modules/change/service.ts` (`listScheduledWindows`)
- Create: `src/server/audit/read.ts` (`recentEvents`)
- Test: extend each module's `__tests__/service.test.ts`; create `src/server/audit/__tests__/read.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // demand/service.ts
  export function countDemandsByStatus(client?: PrismaClient): Promise<Record<$Enums.DemandStatus, number>>;
  //   const rows = await client.demand.groupBy({ by: ["status"], _count: { _all: true } });
  //   seed every DemandStatus key to 0, then fill from rows. (noUncheckedIndexedAccess-safe: build from the enum list.)

  // incident/service.ts
  export function listOverdueIncidents(client?: PrismaClient): Promise<Record<string, unknown>[]>;
  //   rows where status NOT IN (RESOLVED, CLOSED) AND dueAt < now; include the assignee display name;
  //   map through serializeIncident(SYSTEM_INTERNAL_ACTOR, row, { now, linkedChanges: [] }) OR a light shape { id, ref, title, priority, dueAt, assigneeName }.
  //   RULING: return the light shape — the dashboard row needs id/ref/title/priority/dueAt/assigneeName only, and calling serializeIncident needs an Actor.
  //   Sort: dueAt asc (most overdue first).

  // change/service.ts
  export function listScheduledWindows(client?: PrismaClient): Promise<{ id: string; ref: string; title: string; windowStart: string; windowEnd: string }[]>;
  //   where: { status: "SCHEDULED", windowStart: { not: null, lte: <now + 14d> } }  orderBy: { windowStart: "asc" }
  //   (a SCHEDULED change always has a window — Task 7 of plan-03 sets it — but guard windowStart != null anyway.)

  // src/server/audit/read.ts
  export function recentEvents(limit: number, client?: PrismaClient): Promise<{ at: string; action: string; label: string; actorId: string | null; subjectType: string; subjectId: string }[]>;
  //   client.auditEvent.findMany({ orderBy: { at: "desc" }, take: limit, select: { at, action, actorId, subjectType, subjectId } })
  //   .map(e => ({ ...e, at: e.at.toISOString(), label: auditActionLabel(e.action) }))
  ```

- [ ] **Step 1: Write the failing tests** (one per addition):
  - `countDemandsByStatus` — seed 2 SUBMITTED, 1 TRIAGING, 1 CONVERTED → `{ SUBMITTED: 2, TRIAGING: 1, WORTH_ASSESSED: 0, APPROVED: 0, REJECTED: 0, CONVERTED: 1 }`.
  - `listOverdueIncidents` — seed one incident past `dueAt` + open, one not; assert only the first is returned, with `assigneeName` populated when assigned.
  - `listScheduledWindows` — seed a SCHEDULED change with a window 3 days out and one 20 days out; assert only the 3-day one, ISO strings, date-ordered.
  - `recentEvents(5)` — write 7 audit events (via `writeAudit` inside `runWithContext`); assert 5 returned newest-first, each with a non-empty `label`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** each. `countDemandsByStatus` must produce a fully-populated record — start from `["SUBMITTED","TRIAGING","WORTH_ASSESSED","APPROVED","REJECTED","CONVERTED"].reduce((acc, k) => ({ ...acc, [k]: 0 }), {})` then overlay `groupBy` results.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/demand/service.ts src/server/modules/incident/service.ts src/server/modules/change/service.ts src/server/audit/ src/server/modules/*/__tests__/
git commit -m "feat: dashboard read APIs — countDemandsByStatus, listOverdueIncidents, listScheduledWindows, recentEvents

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `overview` service + `GET /api/overview`

**Files:**
- Create: `src/server/modules/overview/service.ts`, `src/lib/api/schemas/overview.ts`, `src/app/api/overview/route.ts`
- Test: `src/server/modules/overview/__tests__/overview.test.ts`, `src/app/api/overview/__tests__/overview.route.test.ts`

**Interfaces:**
- Consumes: `listDemands` / `countDemandsByStatus` (`@/server/modules/demand/service`), `listIncidents` / `listOverdueIncidents` (`@/server/modules/incident/service`), `listChanges` / `listScheduledWindows` (`@/server/modules/change/service`), `listApprovalsForActor` (`@/server/modules/approval/service`), `recentEvents` (`@/server/audit/read`), `requireInternal` (`@/server/policy/subjects/helpers`), `Actor` / `hasHat`.
- Produces:
  ```ts
  export type OverviewPayload = {
    tiles: { myOpenItems: number; approvalsWaiting: number; overdue: number; demandsInTriage: number };
    myQueue: { id: string; kind: "incident" | "change" | "demand"; ref: string; title: string; hint: string; href: string; overdue: boolean; sortKey: number }[];
    approvals: { subjectType: string; subjectId: string; subjectRef: string; subjectTitle: string; currentRequiredHat: string; needsOverride: boolean; href: string }[];
    activity: { at: string; label: string; text: string }[];   // text = a human sentence built from label + subjectType + subjectId
    funnel: { stage: string; label: string; count: number }[];  // submitted → triaging → worth_assessed → approved(pursue) → converted ; EXCLUDES rejected
    windows: { id: string; ref: string; title: string; windowStart: string; windowEnd: string }[];
    emailFailures: { count: number; recent: { toEmail: string; template: string; lastError: string | null; attempts: number }[] };
  };
  export function buildOverview(actor: Actor, client?: PrismaClient): Promise<OverviewPayload>;
  //   requireInternal(actor) FIRST.
  ```
  - **`tiles.myOpenItems`** = incidents `assigneeId == actor.id` not RESOLVED/CLOSED + changes `ownerId == actor.id` not CLOSED/ROLLED_BACK.
  - **`tiles.approvalsWaiting`** = `listApprovalsForActor(actor)`.length.
  - **`tiles.overdue`** = `listOverdueIncidents()`.length.
  - **`tiles.demandsInTriage`** = `countDemandsByStatus()` TRIAGING + WORTH_ASSESSED.
  - **`myQueue`** (ruling 7): the incidents + changes above, plus TRIAGING demands where `(hasHat(actor,"BUSINESS_APPROVER") && worth.valueScore == null) || (hasHat(actor,"TECHNICAL_APPROVER") && worth.effort == null)`. `overdue` true for an incident past `dueAt`. `sortKey`: overdue → 0, else the `dueAt`/`createdAt` epoch ms. `hint`: e.g. "SLA overdue" / "Response due in 3h" / "Needs your value score" / "You own this change".
    - Reads: `listIncidents(actor, { mine: true })` + `listChanges(actor, { mine: true })` + `listDemands(actor, { status: "TRIAGING" })` (the internal serializers give you `worth` on the demand rows).
  - **`emailFailures`** — a small `client.emailOutbox` read: `count({ where: { status: "FAILED", updatedAt: { gte: <now - 7d> } } })` + `findMany({ ..., take: 10, orderBy: { updatedAt: "desc" }, select: { toEmail, template, lastError, attempts } })`. **This is the one place the overview service touches Prisma directly** — spec 05 §8 owns the `EmailOutbox` read and there is no `notify` read function for it yet. **Ruling: add `listFailedEmails(client?)` to `src/server/modules/notify/read.ts`** (Task 1's file) instead, so the overview service stays Prisma-free. Add it in THIS task as a one-function extension of `read.ts` + a test.
  - **`funnel`**: `[{stage:"submitted",...},{stage:"triaging",...},{stage:"worth_assessed",...},{stage:"approved",label:"Approved (pursue)",count: <APPROVED demands whose worth.decision === "PURSUE">},{stage:"converted",...}]` — the first three + converted from `countDemandsByStatus`; the "approved (pursue)" count needs `listDemands(actor, { status: "APPROVED" })` filtered by `decision === "PURSUE"` (or a dedicated count — keep it a filtered list length for v1).

- [ ] **Step 1: Write the failing tests**
  - `overview.test.ts` — seed a fixture covering every state (demands in each status, an overdue incident assigned to the actor, a change owned by the actor, a SCHEDULED change, a pending approval whose hat the actor holds, a TRIAGING demand missing a value score, a FAILED EmailOutbox row); assert every tile count, `myQueue` membership + `overdue` flag + sort order, `funnel` sums (and that REJECTED is excluded), `windows`, `emailFailures.count`.
  - **Actor-relative test** (spec 06 §5): the same fixture, a `BUSINESS_APPROVER`-only actor vs a `TECHNICAL_APPROVER`-only actor → different `myQueue` demand rows (value-score-missing vs effort-missing); an all-hats actor → the union.
  - **Guest test**: `buildOverview(guestActor)` → throws `ForbiddenError`.
  - **Architecture test**: `overview/service.ts`'s source text contains no `@prisma/client`, no `@/server/db/client`, no `.$queryRaw`, no `.$executeRaw` (read the file, assert with a regex).
  - `overview.route.test.ts` — no session → 401; a guest → 403; an internal actor → 200 with the payload shape (validate against `overviewResponse.parse`).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `listFailedEmails` in `read.ts`, then `overview/service.ts`, `overview.ts` schema, the route.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/overview/ src/server/modules/notify/read.ts src/lib/api/schemas/overview.ts src/app/api/overview/ src/server/modules/notify/__tests__/
git commit -m "feat: overview service and GET /api/overview

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `/overview` page — shell, tiles, my-queue, approvals

**Files:**
- Create: `src/app/(internal)/overview/page.tsx`, `OverviewClient.tsx`, `overview.module.css`, `panels/MyQueuePanel.tsx`, `panels/ApprovalsPanel.tsx`
- Modify: `src/app/(internal)/AppShellChrome.tsx` (add the `overview` NavItem, first)
- Test: `src/app/(internal)/overview/__tests__/overview.test.tsx`

**Interfaces:**
- `page.tsx` — server component; `getCurrentActor()` → `redirect("/login")` if null; `if (actor.kind !== "INTERNAL") redirect("/portal")`; `whoami()`; `const initial = await buildOverview(actor)`; render `<OverviewClient initial={initial} />`.
- `OverviewClient` — `"use client"`; holds `data` state (seeded from `initial`), refetches `/api/overview` on window `focus` + every 60 s (ruling 9); renders the `Tile` row (`@/components/Tile`) + a `Panel` grid (`@/components/Panel`) containing `<MyQueuePanel rows={data.myQueue} />` + `<ApprovalsPanel rows={data.approvals} />` + placeholders for the Task 8 panels (`<ActivityPanel/>` etc. — import them; Task 8 fills them; for Task 7 render `null` or a "loading" stub for those so the page compiles).
- `MyQueuePanel` — a list; each row: an icon per `kind`, `ref` + `title`, the `hint`, an `OVERDUE` `<Pill tone="crit" dot>` when `row.overdue`, wrapped in `<a href={row.href}>`. Empty: "Nothing needs you right now."
- `ApprovalsPanel` — each row: `subjectRef` + `subjectTitle`, `<Pill>{currentRequiredHat}</Pill>`, a "you submitted this — override needed" badge when `needsOverride`, `<a href={row.href}>`. Empty: "No approvals waiting on you."
- Nav item: `{ key: "overview", label: "Overview", href: "/overview", icon: <a grid / gauge svg> }` — **prepended** to `NAV` (Overview is the home).

- [ ] **Step 1: Write the failing test** — `overview.test.tsx` (jsdom, mock `apiFetch` for the refetch; pass an `initial` fixture). Cases: the 4 tiles render their counts; `MyQueuePanel` shows a row per queue item, the OVERDUE badge on the flagged one, rows link to their `href`; `ApprovalsPanel` shows the override badge only where set; empty states.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** the page, client island, the two panels, CSS, the nav item.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add "src/app/(internal)/overview/" "src/app/(internal)/AppShellChrome.tsx"
git commit -m "feat: /overview page — tiles, my queue, approvals

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Overview — activity feed, demand funnel, scheduled windows, email delivery

**Files:**
- Create: `src/app/(internal)/overview/panels/ActivityPanel.tsx`, `FunnelPanel.tsx`, `WindowsPanel.tsx`, `EmailDeliveryPanel.tsx`
- Modify: `src/app/(internal)/overview/OverviewClient.tsx` (mount the four panels), `overview.module.css`
- Test: extend `src/app/(internal)/overview/__tests__/overview.test.tsx`

**Interfaces:**
- `ActivityPanel` — `<ActivityFeed items={...} />` (`@/components/ActivityFeed`, `ActivityItem` = `{ id, text, meta, tone? }`). Map `data.activity` → `{ id: <at+idx>, text: item.text, meta: <relative time from item.at> }`.
- `FunnelPanel` — a horizontal bar per `data.funnel` stage: the `label`, the `count`, a bar whose width is `count / max * 100%` (max across the stages, min 1). Tokens only. `role="img"` with an `aria-label` summarising the funnel.
- `WindowsPanel` — a compact date-ordered list of `data.windows`: `ref`, `title`, `windowStart` formatted (`toISOString().slice(0,16).replace("T"," ")`) → `windowEnd` time. Empty: "No changes scheduled in the next 14 days."
- `EmailDeliveryPanel` — a `Tile`-like block: `data.emailFailures.count` failed in the last 7 days; when `> 0`, an expandable list of `{ toEmail, template, lastError, attempts }`. Internal-runbook note: "retry is a manual DB action in v1". Tone `crit` when `count > 0`, else `ok`.

- [ ] **Step 1: Write the failing test** — extend `overview.test.tsx`: the activity feed renders a line per event; the funnel renders a bar per stage with the right counts; the windows panel lists the scheduled changes; the email panel shows the failure count and expands the list.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** the four panels + wire them into `OverviewClient`.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add "src/app/(internal)/overview/"
git commit -m "feat: overview — activity feed, demand funnel, scheduled windows, email delivery

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Repoint the internal home to `/overview`

**Files:**
- Modify: `src/app/page.tsx`, `src/app/login/page.tsx`, `src/app/(internal)/layout.tsx`, `src/app/portal/(guest)/layout.tsx`, `src/middleware.ts` (if it references `/demands` as a target), `src/app/(internal)/demands/page.tsx` (add `?open` reading to the register — see below)
- Modify: `src/app/(internal)/demands/DemandRegister.tsx` — add `?open=<id>` reading (mirror `IncidentRegister` / `ChangeRegister`) so the Overview my-queue demand deep links open the drawer
- Test: extend `src/app/login/__tests__/*` if it asserts the redirect target; add a `DemandRegister` `?open` test

**This is a small mechanical batch.** All the `redirect("/demands")` / `// TODO(plan-06)` sites become `/overview`:
- `src/app/page.tsx` — `redirect("/overview")`, drop the TODO comment.
- `src/app/login/page.tsx` — the post-auth `actor.kind === "INTERNAL" ? "/demands" : "/portal"` → `"/overview"`.
- `src/app/(internal)/layout.tsx` — if a guest hits an internal route the layout redirects them; that target is `/portal` (unchanged). No `/demands` here unless the file has a fallback — check.
- `src/app/portal/(guest)/layout.tsx` — `if (actor.kind !== "GUEST") redirect("/demands")` → `redirect("/overview")`, drop the TODO.
- `src/middleware.ts` — check line ~58 `NextResponse.redirect(... "/login" ...)` — that's the unauth path, unchanged. Only change a hardcoded `/demands` home target if one exists.
- **`DemandRegister` `?open`**: `const openParam = useSearchParams().get("open")`; `useState<string | null>(openParam)` seeds `openId`; the existing `<DemandDrawer>` mount uses it. Mirror `IncidentRegister.tsx`'s exact approach.

- [ ] **Step 1: Write / adjust the failing tests** — the `DemandRegister` `?open` test (mock `useSearchParams` to return an id → the drawer mounts + `apiFetch`es `/api/demands/<id>`); adjust any login-redirect test to expect `/overview`.

- [ ] **Step 2: Run, verify fail** (the DemandRegister test; the redirect tests if present).

- [ ] **Step 3: Apply the repoints + the `?open` reading.**

- [ ] **Step 4: Run, verify pass. Full gate** (`grep -rn '"/demands"' src/app | grep -i redirect` should return nothing meaningful).

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/login/page.tsx "src/app/(internal)/" "src/app/portal/(guest)/layout.tsx" src/middleware.ts
git commit -m "feat: /overview is the internal home; demand register reads ?open

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Portal top bar — client org name, bell, account menu

**Files:**
- Replace: `src/app/portal/(guest)/layout.tsx`
- Create: `src/app/portal/(guest)/PortalTopBar.tsx`, extend `src/app/portal/(guest)/portal.module.css`
- Test: extend `src/app/portal/(guest)/__tests__/layout.test.tsx`

**Interfaces:**
- `layout.tsx` — server component; keep the guard (`getCurrentActor()` → `/login`; non-guest → `/overview` per ruling 8). Read the client org name: `whoami()` gives `clientId`; **add a `clientName` to `whoami`'s `Me` type** OR do a narrow read here — **Ruling: a narrow read in the layout** (`const client = actor.clientId ? await prisma... ` — NO, the layout is `src/app/**`, no Prisma. **Ruling: add `clientName: string | null` to `Me`** in `src/server/auth/current.ts` — `whoami` already joins `user`; extend the select to `user: { include: { client: { select: { name: true } } } }` and return `client?.name ?? null`). Pass `clientName` + `me.displayName` to `<PortalTopBar>`.
- `PortalTopBar` — `"use client"`; the slim bar: the Keel mark + the client org name; the three-item nav (`My requests` → `/portal/demands`, `My incidents` → `/portal/incidents`, `Submit` → `/portal/submit`); `<NotificationBell />`; an account menu (a Radix `Popover` or a `<details>`) showing `displayName` + a "Sign out" (`<LogoutButton />` or an inline post to `/api/auth/logout`). Narrower max-width via the CSS module.

- [ ] **Step 1: Extend `Me` + `whoami`** — `src/server/auth/current.ts`: `Me` gains `clientName: string | null`; `whoami`'s query includes `client: { select: { name: true } }`; return it. Update the one existing `whoami` consumer (`src/app/(internal)/layout.tsx` / `AppShellChrome`) — it destructures specific fields, so an added field is safe, but confirm `tsc`.

- [ ] **Step 2: Write the failing test** — `layout.test.tsx` (jsdom): render `<PortalTopBar clientName="Northwind Traders" displayName="Nadia" />` → the org name shows; the three nav links have the right hrefs; the bell renders (mock `apiFetch`); the account menu shows the display name + a sign-out control.

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Implement** the new `layout.tsx` + `PortalTopBar` + CSS.

- [ ] **Step 5: Run, verify pass. Full gate.**

- [ ] **Step 6: Commit**

```bash
git add "src/app/portal/(guest)/" src/server/auth/current.ts "src/app/(internal)/"
git commit -m "feat: portal top bar — client org name, notification bell, account menu

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: `/portal/submit` two-tab page

**Files:**
- Create: `src/app/portal/(guest)/submit/page.tsx`, `SubmitTabs.tsx`, `PortalDemandForm.tsx`, `submit.module.css`
- Move: `src/app/portal/(guest)/incidents/new/PortalIncidentForm.tsx` → `src/app/portal/(guest)/submit/PortalIncidentForm.tsx` (or keep it where `PortalIncidentDetail`/others import it and just import across — **Ruling: move it to `submit/`** and update imports)
- Delete: `src/app/portal/(guest)/incidents/new/` (the whole directory — `page.tsx` + `PortalIncidentForm.tsx`)
- Modify: any nav/link pointing at `/portal/incidents/new` → `/portal/submit`
- Test: `src/app/portal/(guest)/submit/__tests__/submit.test.tsx`; adjust `src/app/portal/(guest)/incidents/__tests__/portal.test.tsx` if it renders `PortalIncidentForm` from the old path

**Interfaces:**
- `page.tsx` — server component; `getCurrentActor()` guard; render `<SubmitTabs />`.
- `SubmitTabs` — `"use client"`; two tabs ("Request software or a feature" / "Report a problem with delivered software"), a `useState` for the active tab, `role="tablist"` / `role="tab"` / `role="tabpanel"` with proper `aria-selected` / `aria-controls`. Renders `<PortalDemandForm />` or `<PortalIncidentForm />`.
- `PortalDemandForm` — `"use client"`; fields: title, "what do you need and why" (`problem`), optional "which product" (`affectedService`). `apiFetch("/api/demands", { method: "POST", body: { title, problem, affectedService?, source: "CLIENT" } })` — wait: does `createDemandBody` accept `source` from a guest? Check `src/lib/api/schemas/demands.ts` + `createDemand` — plan-01 has the guest create set `clientId`/`submittedById` server-side but `source` comes from the body. **Ruling: the guest form sends `source: "CLIENT"`; `createDemand` already trusts the body's `source`** (plan-01 Task 2 — a guest can only realistically send `CLIENT`, and the demand register shows the source; not a security issue since a guest's demand is client-scoped regardless). On 201 → `router.push("/portal/demands")`.
- `PortalIncidentForm` — unchanged behaviour (moved file): title / description / which software / "how much is it affecting you", `POST /api/incidents`, on 201 → `router.push("/portal/incidents")`.

- [ ] **Step 1: Write the failing test** — `submit.test.tsx` (jsdom, mock `apiFetch` + `next/navigation`). Cases: both tabs render; clicking a tab switches the panel (`aria-selected` moves); `PortalDemandForm` posts to `/api/demands` with `source: "CLIENT"` + the three fields and routes to `/portal/demands`; `PortalIncidentForm` posts to `/api/incidents` and routes to `/portal/incidents`; a blank required field blocks submit.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — create `submit/`, move `PortalIncidentForm`, delete `incidents/new/`, repoint the nav link (`PortalTopBar` from Task 10 already points at `/portal/submit` — confirm), fix imports.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add "src/app/portal/(guest)/submit/" "src/app/portal/(guest)/incidents/"
git commit -m "feat: unified /portal/submit two-tab page; retire /portal/incidents/new

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: Unread-comment dot on portal cards

**Files:**
- Modify: `src/app/portal/(guest)/demands/page.tsx` + `PortalDemandList.tsx`, `src/app/portal/(guest)/incidents/page.tsx` + `PortalIncidentList.tsx`
- Test: extend the portal list tests

**Interfaces:**
- Each portal list `page.tsx` (server component) computes the unread set (ruling 4):
  ```ts
  import { listNotifications } from "@/server/modules/notify/read";
  const unread = await listNotifications(actor, { kind: "COMMENTED", unread: true });
  const unreadSubjectIds = new Set(unread.map((n) => n.subjectId));
  ```
  and passes `unreadSubjectIds` (as a plain `string[]` — a `Set` is not serialisable across the server/client boundary if the list is a client component; pass an array, build the `Set` in the component) to `<PortalDemandList rows={rows} unreadIds={[...]} />`.
- `PortalDemandList` / `PortalIncidentList` — a `<span className={styles.dot} aria-label="unread messages">` on a card whose `row.id` is in the unread set. Position it top-right of the card. Token colour (`--accent`).

- [ ] **Step 1: Write the failing test** — extend `portal.test.tsx` (demands + incidents): a list with `unreadIds` containing one row's id → that card has the dot (`getByLabelText("unread messages")` within it), the others don't.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — the `page.tsx` fetch + the component dot.

- [ ] **Step 4: Run, verify pass. Full gate.**

- [ ] **Step 5: Commit**

```bash
git add "src/app/portal/(guest)/"
git commit -m "feat: unread-comment dot on portal request and incident cards

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 13: Seed demo notifications + overview integration test + CONTRACTS amendment

**Files:**
- Modify: `prisma/seed.ts` (`seedDemoNotifications()`), `CONTRACTS.md`
- Create: `src/server/modules/overview/__tests__/overview.integration.test.ts`

- [ ] **Step 1: `seedDemoNotifications()`** — behind `NODE_ENV !== "production"`, called from `main()` after `seedDemoChanges()`. Give the demo internal users (`admin`, `ceo`, `cto`) and the demo guest (`guest@northwind.example`) a handful of `Notification` rows across the five kinds — some read, some unread — pointing at the demo `DEM-9001..3` / `INC-9001..4` / `CHG-9001..3` refs (look them up for ids). Idempotent: `upsert` is awkward for notifications (no natural key) — instead, `deleteMany({ where: { userId: { in: [demo user ids] }, subjectId: { startsWith: ... } } })` then `createMany`, OR guard the whole function on `notification.count({ where: { userId: admin.id } }) === 0`. **Ruling: the count guard** — simplest, and a re-seed then leaves existing rows alone. Also seed ONE `EmailOutbox` row `status: "FAILED"` so the Email-delivery panel has content. Update the `console.log`.

- [ ] **Step 2: `pnpm prisma db seed` twice** (idempotent), `pnpm typecheck && pnpm lint`.

- [ ] **Step 3: The integration test** — `overview.integration.test.ts`, one `test()`:
  1. seed a full fixture: a `DEVELOPER`+`BUSINESS_APPROVER` internal actor, demands across every status (incl. an APPROVED/PURSUE and a REJECTED), an overdue incident assigned to the actor, a change the actor owns, a SCHEDULED change with a window 5 days out, a PENDING approval whose current step's hat the actor holds, a TRIAGING demand missing a value score, a FAILED EmailOutbox row, ~10 audit events
  2. `const o = await buildOverview(actor, db())`
  3. assert: `o.tiles` — every count matches a hand-computed expectation; `o.myQueue` contains the incident (overdue: true, sorted first), the change, and the value-score-missing demand, and their `href`s are `/incidents?open=…` / `/changes?open=…` / `/demands?open=…`; `o.approvals` has the pending request with the right `href` (`/approvals`); `o.funnel` stage counts sum to (total demands − REJECTED) and `rejected` is not a stage; `o.windows` has the 5-day change only; `o.emailFailures.count === 1`; `o.activity` has ≥10 items each with a non-empty `label`
  4. a guest actor → `buildOverview` throws `ForbiddenError`
  5. the architecture assertion: read `src/server/modules/overview/service.ts` as text, assert no `/@prisma\/client|@\/server\/db\/client|\.\$queryRaw|\.\$executeRaw/`

- [ ] **Step 4: Run it, full gate green.**

- [ ] **Step 5: CONTRACTS.md amendment** — add a `plan-04` bullet under "Phase 1 amendments": the `notify` read side (`listNotifications` / `unreadCount` / `markRead` / `listFailedEmails` / `hrefFor` / `serializeNotification`, all `userId`-scoped, `notification.view.own`); `GET /api/notifications` + `POST /api/notifications/read`; `NotificationBell` component (`@radix-ui/react-popover` added); `/notifications` page (internal + guest); the dashboard read additions (`countDemandsByStatus`, `listOverdueIncidents`, `listScheduledWindows`, `recentEvents`); `buildOverview` + `GET /api/overview` (internal-only, Prisma-free composition); `/overview` is the internal home (`/` and post-login redirect); `Me.clientName`; the portal top bar + `/portal/submit` two-tab (retiring `/portal/incidents/new`); the unread-comment dot. Consumed by plan-05 (deploy — health/readiness already exist; the dashboard is a smoke-test target).

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts src/server/modules/overview/__tests__/overview.integration.test.ts CONTRACTS.md
git commit -m "test: overview integration; demo notifications; CONTRACTS plan-04 amendment

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: Playwright end-to-end — the client demand journey

**Files:**
- Create: `e2e/client-demand-journey.spec.ts` (or wherever the repo's Playwright config points — **check for `playwright.config.ts`; if absent, this task also scaffolds it minimally**), `e2e/README.md`
- Modify: `package.json` (a `test:e2e` script) if not present
- Test: the spec IS the test

**This is spec 07 §7 / the BRIEF's mandated E2E** — "Playwright E2E for the full client demand journey". It runs against `pnpm build && pnpm start` (or `next dev`) with the seeded database.

- [ ] **Step 1: Check for Playwright** — `ls playwright.config.ts` / `grep playwright package.json`. If Playwright is not a dependency: `pnpm add -D @playwright/test` + `pnpm exec playwright install chromium` + a minimal `playwright.config.ts` (`testDir: "e2e"`, `webServer: { command: "pnpm start", port: 3000, reuseExistingServer: true }`, one `chromium` project). If the CSP / CDN allowlist matters for a bundled test runner — it does not, Playwright drives a real browser against localhost.

- [ ] **Step 2: Write the spec** — `client-demand-journey.spec.ts`:
  1. seed is assumed run (`pnpm prisma db seed`); the guest `guest@northwind.example` / `Keel-guest-2026` exists
  2. `page.goto("/login")`; sign in as the guest → lands on `/portal`
  3. the portal top bar shows "Northwind Traders" and the notification bell
  4. go to `/portal/submit`, the "Request software" tab; fill title + problem + product; submit → redirected to `/portal/demands`; the new request appears with status "In review"
  5. open the request detail → the "Where it is" milestone timeline shows "Received" / "In review" reached; the conversation box is present
  6. (optional, if fast) sign out, sign in as `admin@keel.local` / `Keel-admin-2026`; `/overview` shows a non-zero "Demands in triage" tile; `/demands` shows the guest's new demand
  7. the guest's `/notifications` (sign back in as the guest) lists their rows

- [ ] **Step 3: Run** — `pnpm build && pnpm start &` (background), `pnpm exec playwright test`, kill the server. Green.

- [ ] **Step 4: Commit**

```bash
git add e2e/ playwright.config.ts package.json pnpm-lock.yaml
git commit -m "test: Playwright end-to-end — the client demand journey

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Whole-branch review (before merge)

Two parallel focused reviewers against the full plan-04 diff:

1. **Security / isolation** — every notification query is `userId: actor.id`-scoped with no exceptions (a user cannot list, read, or mark another user's rows — verified per route + per service function); `POST /read { ids }` filters to the actor's own ids; `GET /api/overview` and `/overview` are internal-only (a guest → 403 / redirect, verified); `buildOverview` never leaks another actor's queue; the `overview` service is Prisma-free (architecture test); the portal shell + every portal component receive only client-safe strings (no enum, no internal name in the rendered DOM); the unread-dot computation doesn't expose comment content.
2. **Correctness** — every Overview tile count matches the underlying module read against an every-state fixture; `myQueue` is actor-relative (`BUSINESS_APPROVER` vs `TECHNICAL_APPROVER` get different demand rows; all-hats gets the union); the funnel sums correctly and excludes `REJECTED`; `hrefFor` produces a valid deep link for every `subjectType` × actor-kind; `markRead({ all })` vs `{ ids }` semantics; `unreadCount` matches `listNotifications({ unread: true }).length`; the bell's poll/focus timers are torn down on unmount; `listScheduledWindows` respects the 14-day horizon; `recentEvents` covers every audit action with a label (iterate `AUDIT_ACTION_LABELS`).

Both must come back clean (a small re-gated fix wave is acceptable). Then merge `worktree-keel-foundation` → `master` (`git merge --ff-only`), keep the worktree for plan-05, update the SDD ledger. **Then: add a git remote, `git push -u origin <branch/master>`, and open a pull request** (the user's standing instruction — raise the missing-remote with them at that point).

---

## Self-review (writing-plans skill — done at authoring time)

- **Spec 05 §7 coverage.** Bell + popover + badge + mark-all + "see all" → Task 3. `/notifications` full list + filters → Task 4. `GET /api/notifications` + `POST /read` + `notification.view.own` + `userId = actor.id` scoping → Tasks 1–2. Guest bell in the portal → Task 10. §8 email-delivery tile → Task 6 (`listFailedEmails`) + Task 8 (`EmailDeliveryPanel`).
- **Spec 06 coverage.** §2 reads-only + module read additions → Task 5. §3.1 tiles → Tasks 6–7. §3.2 panels (my queue / approvals / activity / funnel / windows / email) → Tasks 7–8. §3.3 hat shaping → Task 6 (`buildOverview` actor-relative) + its test. §4 one endpoint → Task 6. §5 test plan → each task's RED + Task 13 integration (incl. the architecture + actor-relative + funnel + guard tests). §6 DoD → Task 13.
- **Spec 07 §3–§4 coverage.** §3 the top bar (org name, bell, account menu, 3 nav) → Task 10. §4.4 the two-tab Submit → Task 11. §4.2/§4.3 the unread-comment dot → Task 12. §4.5 milestone timeline for a converted demand → **already shipped in plan-03 (`guestStatusLabel` follows the linked change) + plan-01's `PortalDemandDetail`** — no new task; Task 14's E2E exercises it. The invite page (§4.1) is Phase 0, untouched.
- **Placeholder scan.** Tasks 1, 5, 6 carry full interface blocks + pseudocode with every field named. The UI tasks reference shipped siblings (`IncidentRegister`'s `?open`, `PortalIncidentForm`, the `AppShellChrome` topbar pattern) as concrete on-disk models, not "similar to Task N".
- **Type consistency.** `NotificationView` (Task 1) is consumed unchanged by Tasks 2, 3, 4, 12. `hrefFor(subjectType, subjectId, actorKind)` — same 3-arg signature in Task 1's interface, its test, and Task 6's `overview` composition. `OverviewPayload` (Task 6) is the exact shape `OverviewClient` + every panel consume in Tasks 7–8 and the integration test asserts in Task 13. `Me` gains `clientName` in Task 10 and nothing else reads a removed field.
- **Known soft spots flagged for the executor:** Task 1 must read `emit.ts` first to pin the `payload` shape. Task 6's ruling moves the `EmailOutbox` read into `notify/read.ts` so the `overview` service stays Prisma-free (the architecture test enforces it). Task 9 is a mechanical repoint batch — grep afterwards. Task 14 scaffolds Playwright if absent; if the repo already has an E2E harness, use it instead.
