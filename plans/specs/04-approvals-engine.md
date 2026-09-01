# Spec 04 — Approvals Engine

Generic, multi-step, hat-routed approvals. Records every decision with actor,
time, and reason. Supports the single-approver override with a mandatory typed
justification written to the audit log. No delegation in v1.

Parent: [`../DESIGN.md`](../DESIGN.md). Owner: Phase 1 / C (also owns spec 03).

---

## 1. Scope

**In:** open a request with an ordered list of hat-gated steps; approve /
reject the current step; auto-resolve the request when the last step passes or
any step rejects; cancel a pending request; the single-approver override; the
decision log; the approval panel component; "approvals waiting on me" queries.

**Out (v2):** delegation, parallel steps, quorum / N-of-M, conditional steps,
approval SLAs, re-assignment, external approvers.

Consumers in v1: Change Management (spec 03). The engine is subject-agnostic —
`subjectType` is a string — so Service Requests (v2) reuse it unchanged.

---

## 2. Data owned

`ApprovalRequest`, `ApprovalStep`, `ApprovalDecision`
([`data-model.md`](data-model.md)). Reads `User`. Does not know what a "change"
is.

---

## 3. Model

- An `ApprovalRequest` has `status` `pending` and 1..n `ApprovalStep`s ordered
  by `order`.
- Exactly one step is "current" — the lowest `order` with `status = pending`.
- A step resolves when a valid actor records an `ApprovalDecision`.
  - `approved` → step `approved`; if it was the last, request `approved`.
  - `rejected` → step `rejected` **and** request `rejected` immediately (no
    further steps).
- `resolvedAt` set on the request when it leaves `pending`.
- A rejected or approved request is immutable. A new attempt (spec 03 sending
  the change back through `submit-for-approval`) opens a **fresh** request; the
  old one stays in the log.

---

## 4. Contract (published to consumers)

```ts
openApprovalRequest(tx, {
  subjectType: string;
  subjectId: string;
  createdById: string;                  // the person who submitted the subject; for the SoD check
  policyKey: string;                    // audit / reporting label
  steps: { order: number; requiredHat: Hat }[];
}): Promise<ApprovalRequest>;

getApprovalState(subjectType, subjectId): Promise<{
  status: ApprovalStatus;               // PENDING | APPROVED | REJECTED | CANCELLED
  steps: { order; requiredHat; status; decision? }[];
  currentStep?: { id; requiredHat };
}>;

recordDecision(tx, {
  stepId: string;
  actor: Actor;
  decision: "APPROVED" | "REJECTED";
  reason: string;                       // required, non-empty
  override?: { justification: string }; // required iff SoD would otherwise block
}): Promise<{ requestStatus: ApprovalStatus }>;

cancelRequest(tx, { subjectType, subjectId, reason }): Promise<void>;
// used by spec 03 when a change is withdrawn or edited back below `approval`
```

`recordDecision` is the only decision mutation. It is called from the consumer's
route handler after `authorize(actor, "<subject>.approve.<tier>", subject)`.

---

## 5. Authorization and segregation of duties

`recordDecision` enforces, in order:

1. The step is the current pending step of a pending request — else
   `ConflictError`.
2. `actor.hats` includes `step.requiredHat` — else `ForbiddenError`.
3. **SoD**: `actor.id !== request.createdById`. If equal:
   - without `override` → throw `SegregationError { overrideAction:
     "<policyKey>.step<order>.override" }`. The route returns 409 with a body
     telling the UI to show the override dialog.
   - with `override.justification` (non-empty, min 20 chars) → proceed; set
     `isSingleApproverOverride = true`, store `overrideJustification`.
4. Record the `ApprovalDecision`, resolve the step and maybe the request.

The consumer's `authorize` call already gated the hat at the HTTP layer; step 2
is defence in depth and covers the "holds neither hat" case.

---

## 6. Audit events

Written by the engine, inside the consumer's transaction, sharing its
`requestId`:

- `approval.request_opened` (payload: `policyKey`, step hats)
- `approval.step_approved` (payload: `stepOrder`, `reason`)
- `approval.step_rejected` (payload: `stepOrder`, `reason`)
- `approval.request_resolved` (payload: final `status`)
- `approval.request_cancelled` (payload: `reason`)
- `approval.override` (payload: `stepOrder`, `justification`, `createdById`,
  `actorId`) — **in addition to** `approval.step_approved`

`approval.override` is queryable on its own for the "open single-approver
overrides" dashboard tile and the audit narrative.

---

## 7. Notifications

| Event | Recipients | Kind |
| --- | --- | --- |
| request opened / step becomes current | holders of the step's `requiredHat` (minus `request.createdById`) | `APPROVAL_NEEDED` |
| step approved, next step exists | holders of the next step's hat | `APPROVAL_NEEDED` |
| request resolved | `request.createdById` | `STATUS_CHANGED` |
| override used | every other internal user (transparency) | `STATUS_CHANGED` |

If the only holder of `requiredHat` is `request.createdById`, no
`APPROVAL_NEEDED` email is sent — the UI surfaces the override path instead.

---

## 8. UI — `ApprovalPanel` component

Rendered inside a consumer's drawer (the change drawer in v1). Props:
`{ subjectType, subjectId, actor }`. Renders:

- The step list with status, the step's required hat, and each recorded
  decision (actor, time, reason; a badge when it was an override, with the
  justification shown to internal users).
- When `actor` holds the current step's hat: **Approve** / **Reject** buttons,
  each opening a reason field.
- When `actor` holds the current step's hat **and** is `request.createdById`:
  an **Override & approve** button that opens a dialog requiring the
  justification (min 20 chars) before it will submit. The dialog copy states
  plainly that this is recorded in the audit log.

Also provides `/approvals` page data: `listApprovalsForActor(actor)` →
pending requests whose current step's hat the actor holds, grouped by subject,
with a "needs override (you submitted this)" flag.

---

## 9. Test plan (RED first) — mandated coverage

- **Routing**: 1-step request resolves on one approval; 2-step needs both; a
  rejection at step 1 resolves the request `REJECTED` and step 2 never becomes
  current.
- **Current-step invariant**: recording a decision on a non-current step →
  `ConflictError`; on an already-resolved or cancelled request → `ConflictError`.
- **Hat gate**: an actor without the step's `requiredHat` → `ForbiddenError`.
- **SoD**: `request.createdById` approving without override → `SegregationError`
  with the exact `overrideAction`; with a <20-char justification → rejected;
  with a valid justification → succeeds, `isSingleApproverOverride = true`,
  `overrideJustification` stored, `approval.override` **and**
  `approval.step_approved` both audited.
- **Cancel**: `cancelRequest` on a pending request → `CANCELLED`,
  `approval.request_cancelled` audited; `recordDecision` afterwards →
  `ConflictError`.
- **Decision log**: every `ApprovalDecision` has a non-empty `reason`; the log
  is complete and ordered; a re-opened request does not mutate the prior one.
- **Audit chain**: all engine events share the consumer request's `requestId`.
- **Notifications**: `APPROVAL_NEEDED` targets the right hat at each step and
  excludes `request.createdById`; override notifies the other internal users.
- **Idempotency**: replaying `recordDecision` with the same request id does not
  double-record.

---

## 10. Definition of done

A standard change gets one `TECHNICAL_APPROVER` approval; a high-risk change
gets `TECHNICAL_APPROVER` then `BUSINESS_APPROVER`; a lone `TECHNICAL_APPROVER`
can override their own change's technical step with a justification that lands
in the audit log and notifies the other internal users; `/approvals` shows each
person exactly what is waiting on them; the routing, SoD, and override tests
pass at the enforced threshold.
