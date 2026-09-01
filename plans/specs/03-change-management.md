# Spec 03 — Change Management

RFC → risk / impact assessment → approval → implementation window → mandatory
rollback plan → post-implementation review. Links to the originating demand and
to any incidents caused or fixed. Internal only — a guest never sees a Change
directly, only its effect on their linked demand or incident.

Parent: [`../DESIGN.md`](../DESIGN.md). Owner: Phase 1 / C (also owns spec 04).

---

## 1. Scope

**In:** create (standalone or from a demand), set `changeType`
(`NORMAL` | `EMERGENCY` in v1), edit the RFC, risk / impact assessment, the
mandatory `rollbackPlan` field, submit for approval (delegates to spec 04),
schedule an implementation window, transition through `implementing`, record the
PIR, close, mark rolled back, link incidents (`CAUSED_BY` / `FIXES`), the change
register + drawer with the lifecycle stepper.

**Out (v2):** change calendar UI as a standalone view (a simple list of
scheduled windows is in v1), `STANDARD` (pre-authorised) change type and its
templates, freeze windows. An `EMERGENCY` change in v1 keeps the full lifecycle
but its approval is recorded retrospectively (spec 04 §5, spec 03 §5).

---

## 2. Data owned

`Change`, `ChangeIncidentLink`, `PostImplementationReview`
([`data-model.md`](data-model.md)).
Publishes `createChangeFromDemand(tx, { demandId, title, actor })` for spec 01.
Consumes the approvals module (spec 04) via `openApprovalRequest()` and
approval-status reads.

---

## 3. Lifecycle and exit gates

The `LifecycleStepper` stages map to `ChangeStatus`:

| Stage | Status | Exit gate (all must be checked to advance) |
| --- | --- | --- |
| Draft | `draft` | RFC written; originating demand linked or "standalone" confirmed; owner set |
| Assess | `assessing` | risk level set; impact assessment written; **rollback plan written**; test plan noted in the RFC |
| Approval | `approval` | approval request resolved `approved` (spec 04) |
| Scheduled | `scheduled` | implementation window set (start < end, future); rollback plan still present |
| Implementing | `implementing` | — (advancing means "work done"); on advance, prompt: went to plan? if not → `rolled_back` |
| PIR | `pir` | `valueRealized` recorded; lessons written |
| Closed | `closed` | terminal |
| — | `rolled_back` | terminal; reachable from `implementing`; requires a note |

Gates are server-computed (`canAdvance`) — the stepper's checkboxes reflect
real field state, they are not free-toggled for the substantive gates. The
"confirm standalone" and "went to plan" gates are explicit actor
acknowledgements, audited.

`rollbackPlan` is `NOT NULL`-enforced at the `assessing → approval` transition,
not at the column level (it is null while `draft`).

---

## 4. API surface

| Method + path | Action | Body (Zod) |
| --- | --- | --- |
| `POST /api/changes` | `change.create` | `{ title, rfc, originatingDemandId? }` |
| `GET /api/changes` | `change.view` | query: `status?`, `mine?`, `scheduled?` |
| `GET /api/changes/:id` | `change.view` | — |
| `PATCH /api/changes/:id` | `change.edit` | `{ rfc?, riskLevel?, impactAssessment?, rollbackPlan? }` |
| `POST /api/changes/:id/advance` | `change.transition` | `{ from, acknowledgements? }` |
| `POST /api/changes/:id/submit-for-approval` | `change.submit_for_approval` | — → opens the approval request |
| `POST /api/changes/:id/schedule` | `change.schedule` | `{ windowStart, windowEnd }` |
| `POST /api/changes/:id/pir` | `change.pir` | `{ valueRealized, lessons }` |
| `POST /api/changes/:id/rollback` | `change.transition` | `{ note }` |
| `POST /api/changes/:id/link-incident` | `change.edit` | `{ incidentId, kind }` |

No guest endpoints. `change.view` never resolves for a guest actor.

---

## 5. Approval routing (hand-off to spec 04)

On `submit-for-approval`, the change module calls:

```ts
openApprovalRequest(tx, {
  subjectType: "change",
  subjectId: change.id,
  createdById: change.ownerId,
  policyKey: change.riskLevel === "HIGH" ? "change.high_risk" : "change.standard",
  steps: change.riskLevel === "HIGH"
    ? [{ order: 1, requiredHat: "TECHNICAL_APPROVER" }, { order: 2, requiredHat: "BUSINESS_APPROVER" }]
    : [{ order: 1, requiredHat: "TECHNICAL_APPROVER" }],
});
```

- `change.standard` (LOW / MEDIUM risk): one `TECHNICAL_APPROVER` step.
- `change.high_risk` (HIGH risk): `TECHNICAL_APPROVER` then `BUSINESS_APPROVER`.
- `EMERGENCY` change type: approval is retrospective — the change may advance
  past `approval` before the request resolves, but the request is still opened
  and must be recorded within the PIR gate. `STANDARD` (pre-authorised) change
  type is v2; treat every v1 non-emergency change as `NORMAL`.
- The change advances `approval → scheduled` only when the request resolves
  `APPROVED`. A `REJECTED` request sends the change back to `assessing` with the
  rejection reason surfaced in the drawer; `cancelRequest` is called if the
  owner edits the change back below `approval`.
- SoD and the single-approver override live entirely in spec 04.

---

## 6. Audit events

`change.created` (payload: `originatingDemandId`), `change.edited` (payload:
changed fields), `change.risk_assessed`, `change.rollback_plan_set`,
`change.submitted_for_approval`, `change.advanced` (payload: from, to,
acknowledgements), `change.scheduled` (payload: window), `change.implementing`,
`change.rolled_back` (payload: note), `change.pir_recorded` (payload:
valueRealized), `change.closed`, `change.incident_linked` (payload: incidentId,
kind).

Approval decisions are audited by spec 04.

---

## 7. Notifications

| Event | Recipients | Kind |
| --- | --- | --- |
| submitted for approval | holders of the next step's hat | `APPROVAL_NEEDED` |
| approval resolved | change owner | `STATUS_CHANGED` |
| scheduled | the other internal user | `STATUS_CHANGED` |
| implementing started | the other internal user | `STATUS_CHANGED` |
| rolled back | all `INTERNAL` users | `STATUS_CHANGED` |
| PIR recorded | the other internal user | `STATUS_CHANGED` |
| a linked demand's change reaches `CLOSED` | the demand's `submittedById` (guest-safe copy: "Delivered") | `STATUS_CHANGED` |
| a `FIXES`-linked incident's change reaches `CLOSED` | the incident's `reportedById` ("fixed") | `STATUS_CHANGED` |

The last two are wired in Phase 2 (cross-module) but specified here.

---

## 8. UI

### 8.1 Register (`/changes`)

`DataTable`: `ref`, title, risk label, `LifecyclePips` (stage progress),
originating demand ref, window (if scheduled), owner. Filters: status, mine,
scheduled. A "Scheduled windows" side list (date-ordered) stands in for the
change calendar in v1.

### 8.2 Drawer — the centrepiece

- Header: `ref`, title, risk label, status pill.
- **RFC** — rich text (markdown) — problem, approach, test plan.
- **Risk & impact** — risk level selector, impact assessment text.
- **Rollback plan** — dedicated, always-visible field; empty state is loud
  ("required before approval").
- **`LifecycleStepper`** — the ported component, stages per §3, `canAdvance`
  from the server, `onAdvance` calls `/advance`. Read-only once `closed` /
  `rolled_back`.
- **Review** — a `REVIEWER`-hat actor can leave review comments on the RFC
  (`change.review` → `Comment` with `visibleToClient = false`). This is
  advisory only in v1 and distinct from approving; it does not gate a
  transition.
- **Approval panel** — current request, steps, each step's decision + reason;
  the approve / reject / override controls when the actor holds the current
  step's hat (rendered by spec 04's `ApprovalPanel`).
- **Schedule** — window pickers, visible in `approval`+ once approved.
- **PIR** — `valueRealized` + lessons, visible in `implementing`+.
- **Links** — originating demand (deep link), linked incidents with kind.
- **Timeline** — audit events.

---

## 9. Test plan (RED first)

- **Lifecycle**: every stage transition; `canAdvance` false until each gate's
  backing fields are set; `assessing → approval` blocked without a rollback
  plan; `implementing → rolled_back` path; terminal states reject further
  transitions.
- **From demand**: `createChangeFromDemand` sets `originatingDemandId`, is
  idempotent per request id, and the demand ends `converted`.
- **Routing**: `LOW`/`MEDIUM` risk → 1 step (`TECHNICAL_APPROVER`); `HIGH` risk
  → 2 steps (`TECHNICAL_APPROVER` then `BUSINESS_APPROVER`); rejection returns
  the change to `assessing`.
- **RBAC**: no guest can list, read, or mutate a change; a direct API hit as a
  guest returns 404.
- **Audit**: every transition emits exactly its event; approval decisions
  audited by spec 04 appear in the same `requestId` chain.
- **Notifications**: `APPROVAL_NEEDED` goes to holders of the right hat at each
  step.

---

## 10. Definition of done

A converted demand becomes a Change; an internal user completes the RFC, sets
risk and a rollback plan, submits for approval; approval routes correctly by
risk; the change is scheduled, implemented, reviewed, and closed; the linked
demand flips to "Delivered" for the guest; the lifecycle-gate and routing tests
pass at the enforced threshold.
