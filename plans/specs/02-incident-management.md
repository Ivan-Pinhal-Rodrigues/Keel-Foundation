# Spec 02 — Incident Management

Core incident lifecycle: report → categorise → assign → work → resolve → close.
Priority from impact × urgency. `dueAt` + a derived `overdue` flag — the whole
of v1's SLA. Guests raise and track their own client's incidents.

Parent: [`../DESIGN.md`](../DESIGN.md). Owner: Phase 1 / B.

---

## 1. Scope

**In:** report, categorise (impact × urgency → priority), assign, transition,
resolve with resolution text, close, reopen, the incident list + drawer, the
`overdue` flag, linking an incident to a Change.

**Out (v2):** SLA business-hours calendars, auto-pause "waiting for client",
breach reporting, major-incident process, problem linkage.

---

## 2. Data owned

`Incident` (`specs/data-model.md`). Reads `Client`, `User`. The
`ChangeIncidentLink` join (`CAUSED_BY` / `FIXES`) is owned by the change module
(spec 03); Incident exposes a read `listLinkedChanges(incidentId)` returning
`{ changeId, ref, kind, status }[]`.

---

## 3. Priority and SLA

Impact × Urgency → Priority per the matrix in [`data-model.md`](data-model.md).

`dueAt = createdAt + { P1: 4h, P2: 24h, P3: 72h, P4: 168h }`. Set at creation
and recomputed if categorisation changes while status is `NEW` or `ASSIGNED`
(not after work starts).

`Incident.overdue` is a stored boolean (so it can be indexed and filtered) that
is recomputed on every read and by the notification job:
`now > dueAt AND status NOT IN (RESOLVED, CLOSED)` — a response is never stale.
The notification job also emits one `incident.overdue` notification per incident
the first time it crosses the line, stamping `overdueNotifiedAt` so it never
fires twice.

---

## 4. State machine

```
new ──assign──▶ assigned ──start──▶ in_progress ──resolve──▶ resolved ──close──▶ closed
assigned ──start──▶ in_progress
resolved ──reopen──▶ in_progress
closed ──reopen──▶ in_progress        (internal only, audited, within 14 days)
```

Guards:
- `resolve` requires `resolution` text.
- `close` allowed from `resolved` only.
- Categorisation (impact/urgency) editable in `new` / `assigned`; locked
  afterwards (change requires a comment explaining why, still audited).
- `assigneeId` must be an internal user.

---

## 5. API surface

| Method + path | Action | Body (Zod) |
| --- | --- | --- |
| `POST /api/incidents` | `incident.create` | `{ title, description, affectedService, impact, urgency }` |
| `GET /api/incidents` | `incident.view` (list) | query: `status?`, `priority?`, `overdue?`, `mine?` |
| `GET /api/incidents/:id` | `incident.view` | — |
| `PATCH /api/incidents/:id/categorize` | `incident.categorize` | `{ impact, urgency }` |
| `POST /api/incidents/:id/assign` | `incident.assign` | `{ assigneeId }` |
| `POST /api/incidents/:id/transition` | `incident.transition` | `{ to, resolution? }` |
| `POST /api/incidents/:id/reopen` | `incident.transition` | `{ reason }` |

Guest: `POST` (create), `GET` list + item (own client only), comments. On guest
create, the "how much is it affecting you" answer is appended verbatim to
`description` (never discarded); `impact` / `urgency` are set to `medium` /
`medium` and `priority` to a provisional `P3` pending internal categorisation;
the guest sees "Being assessed" until an internal user categorises it. The guest
`POST` body is `{ title, description, affectedService, affectingLevel }` — it
does not accept `impact` / `urgency` directly.

---

## 6. Authorization specifics

- Guest create: `reportedById` + `clientId` server-side.
- Guest view: `incident.clientId === actor.clientId` only; else 404.
- Guest serializer strips: `assigneeId` (→ "Keel team"), internal comments,
  linked-change internals (shows only "a fix is on the way" when a `FIXES`
  link exists and that change is not yet `CLOSED`; "fixed" when `CLOSED`).
  `INTERNAL_ONLY_KEYS`: `assigneeId`, `overdueNotifiedAt`, internal comment
  bodies.
- Guest-visible status: `NEW|ASSIGNED → "Reported"`,
  `IN_PROGRESS → "Investigating"`, `RESOLVED → "Resolved"`,
  `CLOSED → "Closed"`.

---

## 7. Audit events

`incident.create`, `incident.categorized` (payload: impact, urgency, priority,
dueAt), `incident.assigned`, `incident.transitioned` (payload: from, to),
`incident.resolved` (payload: resolution), `incident.closed`,
`incident.reopened` (payload: reason), `incident.overdue`.

---

## 8. Notifications

| Event | Recipients | Kind |
| --- | --- | --- |
| created by a guest | all `INTERNAL` users | `ASSIGNED` |
| assigned | the assignee | `ASSIGNED` |
| transitioned | `reportedById` (in-app; email if guest) + assignee | `STATUS_CHANGED` |
| resolved | `reportedById` | `STATUS_CHANGED` |
| became overdue | all `INTERNAL` users + assignee | `OVERDUE` |
| comment added | the other party (internal ↔ guest) | `COMMENTED` |

---

## 9. UI

### 9.1 List (`/incidents`)

Card list with a severity rail colour (P1/P2 red, P3 amber, P4 grey). Each
card: `ref`, title, priority tag, affected service, age, `dueAt` countdown,
an `OVERDUE` badge when applicable, assignee avatar. Filters: status, priority,
overdue-only, mine. Newest first.

### 9.2 Drawer

- Header: `ref`, title, priority tag, status pill.
- **Impact** — description + affected service.
- **Categorisation** — impact / urgency selectors → live priority preview;
  editable per §4 guards.
- **Assignment** — assignee selector (internal users).
- **Work** — transition buttons following the state machine; `resolve` opens a
  resolution-text field.
- **SLA** — `dueAt`, time remaining or overdue duration.
- **Linked change** — from `listLinkedChanges`; "caused by" / "fixed by".
- **Timeline** — from audit events.
- Comments (internal + client-visible toggle).

---

## 10. Test plan (RED first)

- **Priority matrix**: all nine impact × urgency combinations.
- **SLA**: `dueAt` set correctly per priority; recompute on re-categorise while
  `new`; no recompute after `in_progress`; `overdue` true/false around the
  boundary; `overdue` never true for `resolved`/`closed`.
- **State machine**: every legal transition; illegal transitions rejected;
  `resolve` without text rejected; `close` only from `resolved`; reopen window.
- **RBAC**: guest create sanitises impact/urgency; guest cannot assign,
  categorise, transition, or view another client's incident; guest serializer
  hides the assignee.
- **Overdue notification**: fires once, not repeatedly (`overdueNotifiedAt`).
- **Audit**: every transition emits exactly its event.

---

## 11. Definition of done

A seeded guest raises an incident; an internal user categorises and assigns it;
it moves through to resolved and closed; the guest tracks it in plain words and
sees SLA state; an overdue incident flags on the dashboard and notifies once;
matrix and SLA tests pass at the enforced threshold.
