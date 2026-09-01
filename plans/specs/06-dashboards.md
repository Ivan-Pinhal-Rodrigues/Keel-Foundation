# Spec 06 — Dashboards

Per-role internal dashboards: my queue, approvals waiting on me, overdue items,
demand pipeline. The guest dashboard is covered by spec 07.

Parent: [`../DESIGN.md`](../DESIGN.md). Owner: Phase 1 / D.

---

## 1. Scope

**In:** the Overview page for internal users, its tiles and panels, the
read-only aggregation queries across demand / incident / change / approvals, the
activity feed, the demand pipeline funnel, the scheduled-windows list.

**Out (v2):** configurable widgets, saved views, metrics / trend charts,
per-user layout, export of dashboard data, date-range controls.

---

## 2. Data — reads only

This module owns **no tables**. It reads through each module's published read
API only:

- `demand`: `listDemands(filter)`, `countByStatus()`
- `incident`: `listIncidents(filter)`, `listOverdue()`
- `change`: `listChanges(filter)`, `listScheduledWindows()`
- `approvals`: `listApprovalsForActor(actor)`
- `audit`: `recentEvents(limit)` (added by spec 00's audit module)

No cross-module `JOIN`s in raw SQL — compose in the service. If a needed read
API is missing, the dashboard owner requests it from the module owner; they do
not add it themselves.

---

## 3. Overview page (`/` → `/overview`)

Internal only. Layout uses the ported `Tile` row + `Panel` + `grid-2` from
Flightdeck.

### 3.1 Tiles (KPI row)

| Tile | Value |
| --- | --- |
| My open items | count assigned to or owned by the actor across incidents + changes, not closed |
| Approvals waiting on me | `listApprovalsForActor(actor)` count (includes "needs your override") |
| Overdue | `incident.listOverdue()` count |
| Demands in triage | demands in `triaging` + `worth_assessed` |

### 3.2 Panels

- **My queue** — a unified list: incidents assigned to me (with SLA state),
  changes I own not in a terminal state, demands where the next action is mine
  (I hold the hat for the missing score / decision). Each row deep-links to the
  item's drawer. Sorted: overdue first, then `dueAt` / age.
- **Approvals waiting on me** — from `listApprovalsForActor`; each row: subject
  ref + title, step tier, "you submitted this — override needed" badge when
  applicable; approve/reject happens in the item drawer (row deep-links there).
- **Recent activity** — `ActivityFeed` from `audit.recentEvents(20)`, rendered
  with human sentences (a small `action → phrasing` map lives here).
- **Demand pipeline** — a funnel: `submitted → triaging → worth_assessed →
  approved(pursue) → converted`, counts per stage, using the prototype's
  `.funnel` component.
- **Scheduled windows** — `change.listScheduledWindows()` next 14 days,
  date-ordered; the v1 stand-in for a change calendar.
- **Email delivery** — the failed-email tile from spec 05 §8.

### 3.3 Hat shaping

- Both internal users see the same Overview; "my" panels are actor-relative.
- A `BUSINESS_APPROVER`'s "next action is mine" queue includes demands missing a
  value score and their pending business-approval steps; a `TECHNICAL_APPROVER`'s
  includes demands missing an effort score and pending technical-approval steps.
  Someone holding both hats sees both.
- No guest ever reaches this page (route-group guard: `authorize(actor,
  "audit.view", { type: "audit" })`; guests are redirected to `/portal`).

---

## 4. API surface

| Method + path | Returns |
| --- | --- |
| `GET /api/overview` | `{ tiles, myQueue, approvals, activity, funnel, windows, emailFailures }` in one payload |

One endpoint, one round trip, composed server-side. Zod response schema in
`src/lib/api/schemas/overview.ts`. Revalidated on focus and every 60 s
(client), plus after any mutation the user performs.

---

## 5. Test plan (RED first)

- Tile counts correct against a seeded fixture covering every state.
- My-queue is actor-relative: a `BUSINESS_APPROVER`-only user and a
  `TECHNICAL_APPROVER`-only user get different rows from the same data; an
  all-hats user gets the union.
- Overdue count matches `incident.listOverdue()`.
- Funnel stage counts sum correctly and exclude `REJECTED`.
- Activity feed renders a sentence for every `action` value emitted anywhere in
  the app (test iterates the audit action catalogue — a missing phrasing fails).
- Route guard: a guest session hitting `/overview` or `/api/overview` is
  redirected / 403; an unauthenticated request → login.
- The composed endpoint makes no raw cross-module SQL (architecture test:
  `overview` service imports only module `index.ts` files).

---

## 6. Definition of done

Both internal users open Overview and see an accurate, actor-relative picture
of what needs them; every number matches the underlying module; the activity
feed covers every audit action; guests can't reach it; counts are correct
against the every-state seed.
