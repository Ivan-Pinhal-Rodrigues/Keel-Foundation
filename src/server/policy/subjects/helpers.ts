/**
 * Shared predicates for the `subjects/*.rule.ts` modules. Each `require*` either
 * returns (allow) or throws the mapped domain error (deny). Pure — no I/O.
 *
 * `plans/specs/00-foundation.md` §4.2, `plans/DESIGN.md` §3.4–§3.5.
 */
import {
  hasHat,
  isInternal,
  type Actor,
  type Hat,
} from "@/server/policy/actor";
import {
  ForbiddenError,
  NotFoundError,
  SegregationError,
} from "@/server/policy/errors";
import type { Subject } from "@/server/policy/subjects/types";

/** Deny (`ForbiddenError`) unless the actor is an internal user. */
export function requireInternal(actor: Actor): void {
  if (!isInternal(actor)) {
    throw new ForbiddenError("internal users only");
  }
}

/** Deny unless the actor is internal and holds `hat`. */
export function requireHat(actor: Actor, hat: Hat): void {
  requireInternal(actor);
  if (!hasHat(actor, hat)) {
    throw new ForbiddenError(`requires the ${hat} hat`);
  }
}

/** Deny unless the actor is internal and holds at least one of `hats`. */
export function requireAnyHat(actor: Actor, hats: readonly Hat[]): void {
  requireInternal(actor);
  if (!hats.some((h) => hasHat(actor, h))) {
    throw new ForbiddenError(`requires one of: ${hats.join(", ")}`);
  }
}

/**
 * A guest may only touch a subject belonging to their own client. Any other
 * client's row — or an unscoped one — is a `NotFoundError` (→ 404): existence is
 * not revealed (spec §3.5). Internal actors always pass.
 */
export function requireOwnClientOr404(
  actor: Actor,
  subjectClientId: string | null | undefined,
): void {
  if (isInternal(actor)) return;
  if (actor.clientId == null || actor.clientId !== subjectClientId) {
    throw new NotFoundError("not found");
  }
}

/**
 * Segregation of duties. The actor must not be the party that raised the
 * subject — the demand's `submittedById`, or the change's `ownerId`. When they
 * are, throw `SegregationError` carrying the `overrideAction` the route offers
 * as the single-approver escape hatch (DESIGN §3.4).
 */
export function requireNotSubmitter(
  actor: Actor,
  submitterId: string | null | undefined,
  overrideAction: string,
): void {
  if (submitterId != null && actor.id === submitterId) {
    throw new SegregationError(overrideAction);
  }
}

/**
 * Fail closed for a segregation-of-duties check. `requireNotSubmitter` is a
 * no-op when the id it compares is absent, so an SoD rule must first assert that
 * the subject actually carries the submitter / owner id. A subject passed
 * without it cannot be verified → deny outright (`ForbiddenError`), never a
 * silent allow. Asserts `id` non-null so the caller can hand it straight to
 * `requireNotSubmitter`.
 */
export function requireSubjectId(
  id: string | null | undefined,
  field: string,
): asserts id is string {
  if (id == null) {
    throw new ForbiddenError(
      `cannot verify segregation of duties: ${field} not loaded on the subject`,
    );
  }
}

type DemandSubject = Extract<Subject, { type: "demand" }>;
type IncidentSubject = Extract<Subject, { type: "incident" }>;
type ChangeSubject = Extract<Subject, { type: "change" }>;

/** Narrow a `Subject` to the `demand` variant, or `null` for any other type. */
export const asDemand = (s: Subject): DemandSubject | null =>
  s.type === "demand" ? s : null;

/** Narrow a `Subject` to the `incident` variant, or `null`. */
export const asIncident = (s: Subject): IncidentSubject | null =>
  s.type === "incident" ? s : null;

/** Narrow a `Subject` to the `change` variant, or `null`. */
export const asChange = (s: Subject): ChangeSubject | null =>
  s.type === "change" ? s : null;
