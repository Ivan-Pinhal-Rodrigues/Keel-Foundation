/**
 * The authorization matrix — data for `matrix.test.ts`.
 *
 * `plans/specs/00-foundation.md` §4.3: every action × { guest, internal with
 * each single hat, internal with all four hats } → allow / deny, plus the guest
 * cross-client, risk-gate, and segregation-of-duties edges.
 *
 * `expected`:
 *   "allow"                     — `authorize` returns
 *   "deny"                      — throws `ForbiddenError`
 *   "notfound"                  — throws `NotFoundError` (guest cross-client)
 *   "segregation:<action>"      — throws `SegregationError`, `.overrideAction === <action>`
 */
import type { Action } from "@/server/policy/actions";
import type { Actor } from "@/server/policy/actor";
import type { Subject } from "@/server/policy/subjects/types";

export type Outcome = "allow" | "deny" | "notfound" | `segregation:${string}`;

export type MatrixCase = {
  label: string;
  actor: Actor;
  action: Action;
  subject: Subject;
  expected: Outcome;
};

// --- canonical actors -----------------------------------------------------
const GUEST_A: Actor = {
  id: "guest-A",
  kind: "GUEST",
  hats: [],
  clientId: "cli-A",
};
const DEV: Actor = {
  id: "u-dev",
  kind: "INTERNAL",
  hats: ["DEVELOPER"],
  clientId: null,
};
const REV: Actor = {
  id: "u-rev",
  kind: "INTERNAL",
  hats: ["REVIEWER"],
  clientId: null,
};
const BIZ: Actor = {
  id: "u-biz",
  kind: "INTERNAL",
  hats: ["BUSINESS_APPROVER"],
  clientId: null,
};
const TECH: Actor = {
  id: "u-tech",
  kind: "INTERNAL",
  hats: ["TECHNICAL_APPROVER"],
  clientId: null,
};
const ALL: Actor = {
  id: "u-all",
  kind: "INTERNAL",
  hats: ["DEVELOPER", "REVIEWER", "BUSINESS_APPROVER", "TECHNICAL_APPROVER"],
  clientId: null,
};

const SWEEP = { GUEST: GUEST_A, DEV, REV, BIZ, TECH, ALL } as const;
type SweepName = keyof typeof SWEEP;

const A = "allow" as const;
const D = "deny" as const;

/** Six rows — one per canonical actor — for one action against one subject. */
function sweep(
  action: Action,
  subject: Subject,
  out: Record<SweepName, Outcome>,
): MatrixCase[] {
  return (Object.keys(SWEEP) as SweepName[]).map((name) => ({
    label: name,
    actor: SWEEP[name],
    action,
    subject,
    expected: out[name],
  }));
}

/** One hand-written edge case. */
function one(
  label: string,
  actor: Actor,
  action: Action,
  subject: Subject,
  expected: Outcome,
): MatrixCase {
  return { label, actor, action, subject, expected };
}

export const CASES: MatrixCase[] = [
  // === base sweep: every action × six actor shapes ====================
  ...sweep(
    "demand.create",
    { type: "demand" },
    { GUEST: A, DEV: A, REV: A, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "demand.view",
    {
      type: "demand",
      id: "d-own",
      clientId: "cli-A",
      submittedById: "someone",
    },
    { GUEST: A, DEV: A, REV: A, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "demand.score.value",
    { type: "demand" },
    { GUEST: D, DEV: D, REV: D, BIZ: A, TECH: D, ALL: A },
  ),
  ...sweep(
    "demand.score.effort",
    { type: "demand" },
    { GUEST: D, DEV: D, REV: D, BIZ: D, TECH: A, ALL: A },
  ),
  ...sweep(
    "demand.decide",
    { type: "demand", id: "d1", submittedById: "someone" },
    { GUEST: D, DEV: D, REV: D, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "demand.convert",
    { type: "demand" },
    { GUEST: D, DEV: D, REV: D, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "demand.reject",
    { type: "demand" },
    { GUEST: D, DEV: D, REV: D, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "incident.create",
    { type: "incident" },
    { GUEST: A, DEV: A, REV: A, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "incident.view",
    {
      type: "incident",
      id: "i-own",
      clientId: "cli-A",
      reportedById: "someone",
    },
    { GUEST: A, DEV: A, REV: A, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "incident.categorize",
    { type: "incident" },
    { GUEST: D, DEV: A, REV: D, BIZ: D, TECH: D, ALL: A },
  ),
  ...sweep(
    "incident.assign",
    { type: "incident" },
    { GUEST: D, DEV: A, REV: D, BIZ: D, TECH: D, ALL: A },
  ),
  ...sweep(
    "incident.transition",
    { type: "incident" },
    { GUEST: D, DEV: A, REV: D, BIZ: D, TECH: D, ALL: A },
  ),
  ...sweep(
    "change.create",
    { type: "change" },
    { GUEST: D, DEV: A, REV: D, BIZ: D, TECH: D, ALL: A },
  ),
  ...sweep(
    "change.view",
    { type: "change" },
    { GUEST: D, DEV: A, REV: A, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "change.edit",
    { type: "change", id: "c1", ownerId: "someone" },
    { GUEST: D, DEV: A, REV: D, BIZ: D, TECH: D, ALL: A },
  ),
  ...sweep(
    "change.review",
    { type: "change" },
    { GUEST: D, DEV: D, REV: A, BIZ: D, TECH: D, ALL: A },
  ),
  ...sweep(
    "change.submit_for_approval",
    { type: "change", id: "c1", ownerId: "someone" },
    { GUEST: D, DEV: D, REV: D, BIZ: D, TECH: D, ALL: D },
  ),
  ...sweep(
    "change.approve.technical",
    { type: "change", id: "c1", ownerId: "someone", riskLevel: "MEDIUM" },
    { GUEST: D, DEV: D, REV: D, BIZ: D, TECH: A, ALL: A },
  ),
  ...sweep(
    "change.approve.business",
    { type: "change", id: "c1", ownerId: "someone", riskLevel: "HIGH" },
    { GUEST: D, DEV: D, REV: D, BIZ: A, TECH: D, ALL: A },
  ),
  ...sweep(
    "change.schedule",
    { type: "change" },
    { GUEST: D, DEV: A, REV: D, BIZ: D, TECH: D, ALL: A },
  ),
  ...sweep(
    "change.transition",
    { type: "change" },
    { GUEST: D, DEV: A, REV: D, BIZ: D, TECH: D, ALL: A },
  ),
  ...sweep(
    "change.pir",
    { type: "change" },
    { GUEST: D, DEV: D, REV: D, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "comment.create",
    {
      type: "demand",
      id: "d-own",
      clientId: "cli-A",
      submittedById: "someone",
    },
    { GUEST: A, DEV: A, REV: A, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "comment.view.internal",
    { type: "none" },
    { GUEST: D, DEV: A, REV: A, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "audit.view",
    { type: "audit" },
    { GUEST: D, DEV: A, REV: A, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "audit.export",
    { type: "audit" },
    { GUEST: D, DEV: A, REV: A, BIZ: A, TECH: A, ALL: A },
  ),
  ...sweep(
    "notification.view.own",
    { type: "none" },
    { GUEST: A, DEV: A, REV: A, BIZ: A, TECH: A, ALL: A },
  ),

  // === guest cross-client: 404, never 403 (spec §3.5) =================
  one(
    "guest, another client's demand",
    GUEST_A,
    "demand.view",
    { type: "demand", id: "d-x", clientId: "cli-B", submittedById: "someone" },
    "notfound",
  ),
  one(
    "guest, an unscoped (internal) demand",
    GUEST_A,
    "demand.view",
    { type: "demand", id: "d-int", submittedById: "someone" },
    "notfound",
  ),
  one(
    "guest, another client's incident",
    GUEST_A,
    "incident.view",
    {
      type: "incident",
      id: "i-x",
      clientId: "cli-B",
      reportedById: "someone",
    },
    "notfound",
  ),

  // === demand.decide — SoD: the submitter may not decide ==============
  one(
    "BIZ decides a demand they submitted",
    BIZ,
    "demand.decide",
    { type: "demand", id: "d-mine", submittedById: "u-biz" },
    "segregation:demand.decide.override",
  ),
  one(
    "all-hats decides a demand they submitted — SoD still fires",
    ALL,
    "demand.decide",
    { type: "demand", id: "d-mine", submittedById: "u-all" },
    "segregation:demand.decide.override",
  ),
  one(
    "TECH decides a demand submitted by someone else",
    TECH,
    "demand.decide",
    { type: "demand", id: "d1", submittedById: "u-biz" },
    "allow",
  ),
  // fail closed: the SoD check cannot run without a demand + its submitter id
  one(
    "BIZ decides with a non-demand subject",
    BIZ,
    "demand.decide",
    { type: "none" },
    "deny",
  ),
  one(
    "BIZ decides a demand whose submittedById is not loaded",
    BIZ,
    "demand.decide",
    { type: "demand", id: "d1" },
    "deny",
  ),

  // === change.approve.technical — SoD: the owner may not approve ======
  one(
    "TECH approves a change they own",
    TECH,
    "change.approve.technical",
    { type: "change", id: "c-mine", ownerId: "u-tech", riskLevel: "LOW" },
    "segregation:change.approve.technical.override",
  ),
  one(
    "non-owner TECH approves technically",
    TECH,
    "change.approve.technical",
    { type: "change", id: "c1", ownerId: "someone", riskLevel: "LOW" },
    "allow",
  ),
  one(
    "all-hats approves technical on a change they own",
    ALL,
    "change.approve.technical",
    { type: "change", id: "c-mine", ownerId: "u-all" },
    "segregation:change.approve.technical.override",
  ),
  // fail closed: no ownerId on the subject → cannot verify SoD → deny
  one(
    "TECH approves a change whose ownerId is not loaded",
    TECH,
    "change.approve.technical",
    { type: "change", id: "c1", riskLevel: "HIGH" },
    "deny",
  ),

  // === change.approve.business — risk gate, then SoD =================
  one(
    "BIZ business-approves a MEDIUM-risk change",
    BIZ,
    "change.approve.business",
    { type: "change", id: "c1", ownerId: "someone", riskLevel: "MEDIUM" },
    "deny",
  ),
  one(
    "BIZ business-approves a change with no risk level set",
    BIZ,
    "change.approve.business",
    { type: "change", id: "c1", ownerId: "someone" },
    "deny",
  ),
  one(
    "BIZ business-approves a HIGH-risk change they do not own",
    BIZ,
    "change.approve.business",
    { type: "change", id: "c1", ownerId: "someone", riskLevel: "HIGH" },
    "allow",
  ),
  one(
    "BIZ business-approves a HIGH-risk change they own",
    BIZ,
    "change.approve.business",
    { type: "change", id: "c-mine", ownerId: "u-biz", riskLevel: "HIGH" },
    "segregation:change.approve.business.override",
  ),
  one(
    "BIZ owns a MEDIUM-risk change — the risk gate denies before SoD",
    BIZ,
    "change.approve.business",
    { type: "change", id: "c-mine", ownerId: "u-biz", riskLevel: "MEDIUM" },
    "deny",
  ),
  // fail closed: HIGH risk but no ownerId → cannot verify SoD → deny
  one(
    "BIZ business-approves a HIGH-risk change whose ownerId is not loaded",
    BIZ,
    "change.approve.business",
    { type: "change", id: "c1", riskLevel: "HIGH" },
    "deny",
  ),

  // === change.edit / change.submit_for_approval — ownership, not a hat
  one(
    "the owner edits their own change with no DEVELOPER hat",
    REV,
    "change.edit",
    { type: "change", id: "c-mine", ownerId: "u-rev" },
    "allow",
  ),
  one(
    "the owner submits their own change for approval",
    DEV,
    "change.submit_for_approval",
    { type: "change", id: "c-mine", ownerId: "u-dev" },
    "allow",
  ),
  one(
    "all-hats, not the owner, cannot submit for approval",
    ALL,
    "change.submit_for_approval",
    { type: "change", id: "c1", ownerId: "someone" },
    "deny",
  ),
  one(
    "all-hats submits their own change for approval",
    ALL,
    "change.submit_for_approval",
    { type: "change", id: "c-mine", ownerId: "u-all" },
    "allow",
  ),

  // === comment.create — allowed only on a subject the actor can view ==
  one(
    "guest cannot comment on a change (not a client surface)",
    GUEST_A,
    "comment.create",
    { type: "change", id: "c1", ownerId: "someone" },
    "deny",
  ),
  one(
    "guest cannot comment on another client's demand",
    GUEST_A,
    "comment.create",
    { type: "demand", id: "d-x", clientId: "cli-B", submittedById: "someone" },
    "notfound",
  ),
  one(
    "internal DEV can comment on a change",
    DEV,
    "comment.create",
    { type: "change", id: "c1", ownerId: "someone" },
    "allow",
  ),
  one(
    "comment on a non-viewable subject type",
    DEV,
    "comment.create",
    { type: "audit" },
    "deny",
  ),
];
