# Spec 01 — Demand Management

The primary client-facing intake. A client or internal user submits a demand;
the CEO scores business value; the CTO scores effort and feasibility; together
they decide `pursue` / `park` / `drop`; a pursued demand converts to a Change.

Parent: [`../DESIGN.md`](../DESIGN.md). Owner: Phase 1 / A.

---

## 1. Scope

**In:** submit, triage (value + effort scoring), worth decision, reject, convert
to Change, the demand register and drawer, the prioritisation board.

**Out (v2):** convert-to-Project, WSJF numeric scoring, portfolio budgeting.

---

## 2. Data owned

`Demand`, `WorthAssessment` ([`data-model.md`](data-model.md)). Reads `Client`, `User`. Writes
`Change.originatingDemandId` **only** via the change module's published
`createChangeFromDemand()` — Demand does not write the `Change` table directly.

---

## 3. State machine

```
submitted ──(triage started)──▶ triaging
triaging ──(value + effort both scored, decision recorded)──▶ worth_assessed
worth_assessed ──decision = pursue──▶ approved ──(convert)──▶ converted
worth_assessed ──decision = park──▶ approved        (parked; stays visible, no change yet)
worth_assessed ──decision = drop / explicit reject──▶ rejected
```

Guards:
- `triaging → worth_assessed` requires `businessValue`, `effort`, `costOfDelay`,
  and `decision` all set.
- `approved → converted` only when `decision = pursue` and no existing
  `convertedToChangeId`.
- `park` leaves status `approved` with `decision = park`; re-deciding is allowed
  (re-enters `worth_assessed`).
- Terminal: `converted`, `rejected`.

---

## 4. API surface

| Method + path | Action | Body (Zod) |
| --- | --- | --- |
| `POST /api/demands` | `demand.create` | `{ title, problem, source, affectedService? }` |
| `GET /api/demands` | `demand.view` (list) | query: `status?`, `source?`, `mine?` |
| `GET /api/demands/:id` | `demand.view` | — |
| `POST /api/demands/:id/triage` | `demand.score.*` | starts triage (→ `triaging`) |
| `PATCH /api/demands/:id/value` | `demand.score.value` | `{ businessValue, businessValueScore? }` |
| `PATCH /api/demands/:id/effort` | `demand.score.effort` | `{ effort, feasibilityNote? }` |
| `POST /api/demands/:id/decision` | `demand.decide` | `{ decision, note? }` |
| `POST /api/demands/:id/reject` | `demand.reject` | `{ reason }` |
| `POST /api/demands/:id/convert` | `demand.convert` | `{ changeTitle?, riskHint? }` → creates the Change, returns `{ changeId }` |

Guest sees only `POST /api/demands`, `GET /api/demands` (own client),
`GET /api/demands/:id` (own client), and comment endpoints. Guest list/read is
scoped by `scopeToClient`.

`demand.decide` where `actor.id === demand.submittedById` → `SegregationError`
with `overrideAction: "demand.decide.override"`; the override is recorded on
`WorthAssessment` (`decidedById` + a justification string, mirrored to
`decisionNote`) with an audit `demand.decide.override` event (reuses the
approvals override pattern, spec 04 §5, but inline — a worth decision is not an
`ApprovalRequest`).

---

## 5. Authorization specifics

- A guest may create a demand; `clientId` and `submittedById` are set server-side.
- A guest may view a demand only if `demand.clientId === actor.clientId`.
- Internal-only fields (`WorthAssessment.*`, internal comments, `effort`,
  scores) are stripped by the guest serializer. `INTERNAL_ONLY_KEYS` for demand:
  `worthAssessment`, `affectedServiceInternalNote`, `decidedById`, scorer ids.
- Guest-visible status mapping: `submitted|triaging → "In review"`,
  `worth_assessed → "In review"`, `approved (pursue) → "Approved"`,
  `converted → "In progress"` then follows the linked Change to `"Delivered"`,
  `rejected → "Declined"` (with the public reason if one was given).

---

## 6. Audit events

`demand.create`, `demand.triage_started`, `demand.value_scored`,
`demand.effort_scored`, `demand.decided` (payload: decision, both scores),
`demand.decide.override` (payload: justification), `demand.rejected`,
`demand.converted` (payload: `changeId`).

---

## 7. Notifications

| Event | Recipients | Kind |
| --- | --- | --- |
| demand created by a guest | all `INTERNAL` users | `ASSIGNED` |
| triage started | the other internal user | `STATUS_CHANGED` |
| value scored | `TECHNICAL_APPROVER` hat holders | `STATUS_CHANGED` |
| effort scored | `BUSINESS_APPROVER` hat holders | `STATUS_CHANGED` |
| decided | submitter (in-app always; email if guest submitter) | `STATUS_CHANGED` |
| rejected | submitter | `STATUS_CHANGED` |
| converted | submitter | `STATUS_CHANGED` |

Guest-facing notification copy uses the §5 status words, never internal terms.

---

## 8. UI

### 8.1 Register (`/demands`)

`DataTable`: `ref`, title, source, client, status, a value/effort mini-cell
(`S·M·L` × a value dot), age. Row → drawer. Filter chips: status, source,
"raised by a client". Sort: newest, oldest, "cost of delay".

### 8.2 Drawer

- Header: `ref`, title, status pill, source.
- **Problem** — the submitter's text.
- **Worth assessment** — two side-by-side panels:
  - *Business value* — narrative text + optional 1–10 score; editable only by a
    `BUSINESS_APPROVER`, only in `triaging`.
  - *Effort & feasibility* — `S/M/L` selector + feasibility note; editable only
    by a `TECHNICAL_APPROVER`, only in `triaging`.
- **Cost of delay** — text, any internal user.
- **Decision** — `pursue` / `park` / `drop` buttons, enabled once both panels
  and cost-of-delay are filled. Shows the SoD override dialog when the actor is
  the submitter.
- **Convert** — visible when `decision = pursue` and not yet converted;
  prompts for a change title, calls `/convert`, then deep-links to the Change
  drawer.
- **Activity** — `Timeline` from the demand's audit events.
- Comments section (internal + client-visible toggle).

### 8.3 Prioritisation board (`/demands?view=board`)

Value-vs-effort read: columns `S` / `M` / `L`, rows high / medium / low value,
demands as cards. Read-only ranking aid; the decision still happens in the
drawer. (Chosen scoring model is the worth-gate, not a drag-ranked board —
this view only visualises it.)

---

## 9. Test plan (RED first)

- **Service**: each transition + every guard; missing-field guards reject;
  double-convert rejected; `park` then re-decide.
- **Conversion path** (mandated coverage): `pursue → convert` creates a Change
  with `originatingDemandId`, sets `convertedToChangeId`, emits
  `demand.converted`, is idempotent under a retry (same request id → one
  Change).
- **RBAC**: guest create sets ids server-side; guest cannot score, decide,
  convert, or view another client's demand; CEO cannot set effort; CTO cannot
  set value score (both can if they hold both hats).
- **SoD**: submitter deciding their own demand → override required → justified
  decision recorded + `demand.decide.override` audited.
- **Serializer**: guest demand JSON contains no `INTERNAL_ONLY_KEYS`.
- **Audit**: every transition emits exactly its event.
- **API**: Zod rejection shapes; 404 vs 403 for guest cross-client.

---

## 10. Definition of done

Demand can be submitted by a seeded guest, triaged and decided by CEO + CTO,
and converted to a Change; the guest sees the status progress in plain words;
every step is audited; the conversion-path tests pass at the enforced coverage
threshold.
