# Spec: data model

**Canonical.** This file is the single source of truth for every table, field, and
enum. `DESIGN.md` and the module specs reference it and must not diverge. It is a
sketch, not the final `schema.prisma` — field names and types are binding; index and
relation details may be refined in Phase 0 as long as the semantics hold. Reconciled
with the module specs on 2026-09-01 (identity = `UserKind` + `Hat[]`; `Counter`-based
refs; `ChangeType` enum retained).

Conventions:
- `cuid()` primary keys named `id`; `createdAt` / `updatedAt` on every table; all
  timestamps are `timestamptz`.
- Enum **values** are `SCREAMING_SNAKE_CASE` Prisma enums. Module specs sometimes write
  them lowercase in prose for readability (`triaging`, `pursue`) — same value.
- FK fields are `<entity>ById` / `<entity>Id`. Where a module spec uses a shorter alias
  (`submitterId` → `submittedById`, `reporterId` → `reportedById`), it means this
  file's field.
- Money and scores are integers.

---

## Identity and tenancy

### User
| field | type | notes |
|---|---|---|
| id | String | |
| email | String @unique | |
| passwordHash | String | argon2id |
| kind | Enum `UserKind` | `INTERNAL` \| `GUEST` |
| hats | `Hat[]` | empty for guests |
| clientId | String? | set iff `kind = GUEST` → `Client` |
| displayName | String | |
| isActive | Boolean | default true; deactivation kills sessions |

`enum UserKind { INTERNAL GUEST }`
`enum Hat { DEVELOPER REVIEWER BUSINESS_APPROVER TECHNICAL_APPROVER }`

### Client (external organisation)
| field | type | notes |
|---|---|---|
| id | String | |
| name | String | |
| domain | String? | informational in v1 (no auto-join) |
| isActive | Boolean | |

### Session
Auth.js database-session shape (managed by the Prisma adapter): `id`, `sessionToken @unique`,
`userId`, `expires`. Plus `createdAt`, `lastSeenAt`, `userAgent?`, `ip?` for the revoke UI.

### Account
Auth.js adapter table. Present for schema completeness; unused in v1 (no OAuth).

### GuestInvite
| field | type | notes |
|---|---|---|
| id | String | |
| token | String @unique | random 32-byte, url-safe; stored hashed |
| clientId | String | → `Client` |
| email | String | the invitee |
| createdById | String | → `User` (internal) |
| expiresAt | DateTime | default now + 7 days |
| redeemedAt | DateTime? | single-use |

---

## Work items

### Demand
| field | type | notes |
|---|---|---|
| id | String | |
| ref | String @unique | `DEM-0001`, monotonic per type |
| title | String | |
| problem | String | plain-language need |
| source | Enum `DemandSource` | |
| status | Enum `DemandStatus` | |
| submittedById | String | → `User` |
| clientId | String? | set when a guest submitted it |
| affectedService | String? | free text (v1) |
| convertedToChangeId | String? @unique | → `Change` |
| decidedAt | DateTime? | worth decision timestamp |

`enum DemandSource { CLIENT INCIDENT TECH_DEBT COMPLIANCE OPPORTUNITY INTERNAL }`
`enum DemandStatus { SUBMITTED TRIAGING WORTH_ASSESSED APPROVED REJECTED CONVERTED }`

### WorthAssessment (1:1 with Demand)
| field | type | notes |
|---|---|---|
| id | String | |
| demandId | String @unique | |
| businessValue | String? | narrative from a `BUSINESS_APPROVER` |
| valueScore | Int? | 1–10, set by a `BUSINESS_APPROVER` |
| valueScoredById | String? | must hold `BUSINESS_APPROVER` |
| effort | Enum `Effort`? | set by a `TECHNICAL_APPROVER` |
| feasibility | String? | narrative from a `TECHNICAL_APPROVER` |
| effortScoredById | String? | must hold `TECHNICAL_APPROVER` |
| costOfDelay | String? | any internal user |
| decision | Enum `WorthDecision`? | |
| decidedById | String? | |
| decisionNote | String? | |
| isSingleApproverOverride | Boolean | default false; true when `decidedById == submittedById` of the demand |
| overrideJustification | String? | **required when `isSingleApproverOverride`**; min 20 chars; written to the `demand.decide.override` audit event |

`enum Effort { S M L }`
`enum WorthDecision { PURSUE PARK DROP }`

### Incident
| field | type | notes |
|---|---|---|
| id | String | |
| ref | String @unique | `INC-0001` |
| title | String | |
| description | String | |
| affectedService | String | free text (v1) |
| impact | Enum `Level` | |
| urgency | Enum `Level` | |
| priority | Enum `Priority` | derived, stored |
| status | Enum `IncidentStatus` | |
| reportedById | String | → `User` |
| clientId | String? | set when a guest reported it |
| assigneeId | String? | → `User` (internal) |
| dueAt | DateTime | derived from priority at creation |
| overdue | Boolean | stored for indexing; `now > dueAt && status ∉ {RESOLVED, CLOSED}`; recomputed by the notification job and on every read so a response is never stale |
| overdueNotifiedAt | DateTime? | set once, the first time `overdue` becomes true, to fire the OVERDUE notification exactly once |
| resolution | String? | required to enter `RESOLVED` |
| resolvedAt | DateTime? | |
| closedAt | DateTime? | |

Incident ↔ Change links are the `ChangeIncidentLink` join (below), not a column.

`enum Level { LOW MEDIUM HIGH }`
`enum Priority { P1 P2 P3 P4 }`
`enum IncidentStatus { NEW ASSIGNED IN_PROGRESS RESOLVED CLOSED }`

**Priority matrix** (impact × urgency): H×H → P1; H×M, M×H → P2; H×L, M×M, L×H → P3;
M×L, L×M, L×L → P4.
**`dueAt` offsets from creation:** P1 4h, P2 24h, P3 72h, P4 168h. (Tunable constant.)

### Change
| field | type | notes |
|---|---|---|
| id | String | |
| ref | String @unique | `CHG-0001` |
| title | String | |
| changeType | Enum `ChangeType` | |
| rfc | String? | the RFC body; required to leave `ASSESSING` |
| riskLevel | Enum `Level`? | required to leave `ASSESSING` |
| impactAssessment | String? | required to leave `ASSESSING` |
| rollbackPlan | String? | **required to leave `ASSESSING`** |
| testPlan | String? | |
| status | Enum `ChangeStatus` | |
| ownerId | String | → `User` (internal) |
| windowStart | DateTime? | required to enter `SCHEDULED` |
| windowEnd | DateTime? | required to enter `SCHEDULED` |
| originatingDemandId | String? @unique | → `Demand` |
| implementedAt | DateTime? | |
| closedAt | DateTime? | |

`enum ChangeType { NORMAL STANDARD EMERGENCY }`
`enum ChangeStatus { DRAFT ASSESSING APPROVAL SCHEDULED IMPLEMENTING PIR CLOSED ROLLED_BACK }`

### PostImplementationReview (1:1 with Change)
| field | type | notes |
|---|---|---|
| id | String | |
| changeId | String @unique | |
| valueRealized | Enum `ValueRealized` | `YES PARTIAL NO` |
| lessons | String | |
| reviewedById | String | |
| reviewedAt | DateTime | |

### ChangeIncidentLink
| field | type | notes |
|---|---|---|
| id | String | |
| changeId | String | → `Change` |
| incidentId | String | → `Incident` |
| kind | Enum `LinkKind` | `CAUSED_BY` (this change caused that incident) \| `FIXES` (this change fixes that incident) |

`@@unique([changeId, incidentId, kind])`. `enum LinkKind { CAUSED_BY FIXES }`.
The guest portal's "a fix is on the way" / "fixed" line is derived from a `FIXES`
link plus the linked change's status; nothing else about the change is exposed.

---

## Approvals engine (generic, reusable)

### ApprovalRequest
| field | type | notes |
|---|---|---|
| id | String | |
| subjectType | String | `"Change"` in v1 |
| subjectId | String | |
| policyKey | String | e.g. `change.normal`, `change.highRisk` |
| status | Enum `ApprovalStatus` | `PENDING APPROVED REJECTED CANCELLED` |
| createdById | String | the submitter — used for the SoD check |

### ApprovalStep
| field | type | notes |
|---|---|---|
| id | String | |
| requestId | String | |
| order | Int | 1-based |
| requiredHat | Enum `Hat` | `TECHNICAL_APPROVER`, then `BUSINESS_APPROVER` for high-risk |
| status | Enum `StepStatus` | `PENDING APPROVED REJECTED SKIPPED` |

### ApprovalDecision
| field | type | notes |
|---|---|---|
| id | String | |
| stepId | String | |
| actorId | String | → `User` |
| decision | Enum `DecisionKind` | `APPROVED REJECTED` |
| reason | String | required |
| isSingleApproverOverride | Boolean | true when `actorId == request.createdById` |
| overrideJustification | String? | **required when `isSingleApproverOverride`** |
| decidedAt | DateTime | |

**Routing:** `change.normal` → one step, `TECHNICAL_APPROVER`. `change.highRisk`
(`riskLevel = HIGH`) → step 1 `TECHNICAL_APPROVER`, step 2 `BUSINESS_APPROVER`.
Request is `APPROVED` when all steps are `APPROVED`; `REJECTED` on the first rejection.

---

## Support tables

### Comment
| field | type | notes |
|---|---|---|
| id | String | |
| subjectType | String | `Demand` \| `Incident` \| `Change` |
| subjectId | String | |
| authorId | String | → `User` |
| body | String | |
| visibleToClient | Boolean | default false; guests may only create `true` and only read `true` |

### AuditEvent  (append-only)
| field | type | notes |
|---|---|---|
| id | String | |
| at | DateTime | default now |
| actorId | String? | null for system actions |
| action | String | namespaced, matches the `Action` union |
| subjectType | String | |
| subjectId | String | |
| payload | Json? | before/after or decision detail |
| requestId | String | correlates with logs |

Runtime DB role: `GRANT INSERT, SELECT ON audit_event`. No `UPDATE`, no `DELETE`.
Migration role holds full rights. Enforcement lives in a checked-in SQL migration and is
covered by an integration test that expects a failure on `UPDATE`/`DELETE`.

### Notification
| field | type | notes |
|---|---|---|
| id | String | |
| userId | String | recipient |
| kind | Enum `NotificationKind` | `ASSIGNED APPROVAL_NEEDED STATUS_CHANGED COMMENTED OVERDUE` |
| subjectType | String | |
| subjectId | String | |
| payload | Json | rendered title + link target |
| readAt | DateTime? | |

### EmailOutbox
| field | type | notes |
|---|---|---|
| id | String | |
| toEmail | String | |
| template | String | template id |
| payload | Json | |
| status | Enum `OutboxStatus` | `PENDING SENDING SENT FAILED` |
| attempts | Int | default 0 |
| lastError | String? | |
| sentAt | DateTime? | |
| nextAttemptAt | DateTime | backoff schedule |

Worker: one interval loop, `pg_advisory_lock` on a fixed key so only one replica sends,
exponential backoff, `FAILED` after 6 attempts, structured log per send.

---

## Reference counters

`ref` values (`DEM-`, `INC-`, `CHG-`) come from a `Counter` table (`name @id`, `value Int`)
incremented inside the creating transaction. No reliance on sequence gaps.

---

## Migrations

- Prisma Migrate. One migration per logical change.
- Every migration has a verified down path; CI runs up → down → up on a scratch database.
- The `audit_event` grant migration and the two-role setup are raw SQL migrations checked
  into `prisma/migrations/`.
- No destructive column drops without a preservation step (rename + backfill + later drop).
