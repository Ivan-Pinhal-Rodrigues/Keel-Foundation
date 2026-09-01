# Spec 07 — Guest Portal

The external client surface at `/portal`. A guest submits demands, raises
incidents against delivered software, tracks their own client organisation's
items, and comments. A guest never sees another client, any internal note, the
CMDB, the change calendar, or an item their organisation does not own.

Parent: [`../DESIGN.md`](../DESIGN.md). Owner: Phase 1 / D.

---

## 1. Scope

**In:** the portal layout and navigation, the demand-submit and incident-submit
forms, "my requests" and "my incidents" lists, item detail with a client-safe
timeline and client-visible comments, the invite-redemption page, the portal
notification bell.

**Out (v2):** self-signup, org profile / user management by the client,
attachments, the knowledge base, CSAT, a public status page.

---

## 2. Data owned

None. Consumes `demand`, `incident`, and `notify` read/write APIs. All scoping
and serialization for guests is enforced in those modules (spec 00 §5, spec 01
§5, spec 02 §6) — the portal renders what it is given and adds no privileged
read.

---

## 3. Layout

Separate route group `src/app/portal/` with its own `layout.tsx`:

- Same `tokens.css`, same fonts.
- **No left rail.** A slim top bar: product name, the client organisation name,
  the notification bell, an account menu (name, sign out).
- Primary nav is three items: **My requests**, **My incidents**, **Submit**.
- Narrower max-width, calmer density than the internal app.
- Every internal term is mapped to plain language at the serializer boundary,
  not in the component — the component only ever receives client-safe strings.

---

## 4. Screens

### 4.1 Invite redemption — `/portal/invite/:token`

Public (no session). Shows the inviting organisation name. Form: name +
password + confirm. On submit → `POST /api/guest-invites/:token/redeem` →
logged in → `/portal`. Expired / redeemed / unknown token → a plain "this
invite link is no longer valid" page. (Flow owned by spec 00 §3.3.)

### 4.2 My requests — `/portal/requests`

Cards, newest first: title, status word, a short "what happens next" line,
submitted date, unread-comment dot. Status words (from spec 01 §5):
Received · In review · Approved · In progress · Delivered · Declined.
Empty state: a prompt to submit the first request.

### 4.3 My incidents — `/portal/incidents`

Cards: title, status word (Reported · Investigating · Resolved · Closed),
affected software, SLA line ("response due in 3h" / "response overdue" /
"resolved in 2 days"), unread-comment dot.

### 4.4 Submit — `/portal/submit`

Two tabs:
- **Request software or a feature** → demand. Fields: title, "what do you
  need and why" (the `problem`), optional "which product". `source` is set to
  `CLIENT` server-side.
- **Report a problem with delivered software** → incident. Fields: title,
  description, which software (`affectedService`), "how much is it affecting
  you" (`affectingLevel` — appended verbatim to `description`, per spec 02 §5).
  Priority shown as "Being assessed" until an internal user categorises it.

Client-side validation mirrors the Zod schema; server is authoritative.

### 4.5 Item detail — `/portal/requests/:ref`, `/portal/incidents/:ref`

- Header: ref, title, status word.
- **Where it is** — a client-safe milestone timeline. For a demand that became
  a change: Received → In review → Approved → In progress → Delivered, with the
  reached milestones filled. Derived from the linked change's status by the
  demand serializer; no change details are exposed.
- **Conversation** — comments with `visibleToClient = true`, plus the guest's
  own comments; a box to add one (`comment.create`). Internal author names
  render as "Keel team".
- **Details you gave** — the original submission, read-only.
- For an incident: the SLA line and, when a `fixes` change exists,
  "a fix is on the way" / "fixed on <date>" — nothing more.

---

## 5. API surface (all existing, guest-scoped)

`POST /api/demands`, `GET /api/demands`, `GET /api/demands/:id`,
`POST /api/incidents`, `GET /api/incidents`, `GET /api/incidents/:id`,
`POST /api/comments` (`{ subjectType, subjectId, body }` — `visibleToClient`
forced `true` for a guest author), `GET /api/comments?subject=`,
`GET /api/notifications`, `POST /api/notifications/read`.

No portal-specific endpoints. If the portal needs a shape the internal API does
not return for a guest, that is a serializer change in the owning module, not a
new route here.

---

## 6. Authorization

- The `portal` route group requires a session whose actor has `kind = GUEST`.
  Internal users hitting `/portal` are redirected to `/overview`. A support
  "view as client" mode for internal users is v2.
- Every data call is already `scopeToClient`-guarded server-side. The portal
  never sends `clientId`.
- A guest deep-linking to `/portal/requests/<someone-else's-ref>` → the API
  returns 404 → the portal shows "not found".

---

## 7. Test plan (RED first) — feeds the Playwright E2E

- **Isolation (mandated)**: guest A cannot load guest B's demand or incident —
  via the UI (not listed, direct URL → "not found") and via a direct API call
  (`GET /api/demands/:id` → 404). Both clients seeded.
- **No internal leakage**: the rendered portal DOM for an item with internal
  comments and an assignee contains neither; serializer `INTERNAL_ONLY_KEYS`
  test plus a DOM assertion in the component test.
- **Status mapping**: each internal status renders the correct client word; a
  converted demand follows its change to "Delivered".
- **Submit**: a demand and an incident created via the forms land with
  `source = CLIENT`, `clientId`, and `reportedById` / `submittedById` set
  server-side (never from the request body).
- **Comments**: a guest comment is `visibleToClient = true`; a guest cannot see
  an internal-only comment; internal author shown as "Keel team".
- **Invite**: valid token → account + login; expired/redeemed → invalid page.
- **Route guard**: no session → the invite/login path; internal session →
  redirected to `/overview` (per §6 default).

---

## 8. Definition of done

A seeded client guest logs in via an invite, submits a demand and an incident,
watches both progress in plain language as the internal users work them, comments
and gets replies, and at no point can see the other seeded client's items or any
internal detail. The isolation tests pass at the enforced threshold and back the
Playwright client-journey E2E.
