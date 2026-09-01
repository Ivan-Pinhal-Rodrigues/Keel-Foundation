/**
 * The policy action catalogue — `plans/specs/00-foundation.md` §4.2, verbatim.
 *
 * One string-literal per authorised operation. `auth.*` is deliberately absent:
 * authentication is handled in the auth module, not the policy layer.
 *
 * `authorize(actor, action, subject)` dispatches on these; `ACTIONS` is the
 * runtime array the exhaustive matrix test iterates.
 */
export type Action =
  | "demand.create"
  | "demand.view"
  | "demand.score.value"
  | "demand.score.effort"
  | "demand.decide"
  | "demand.convert"
  | "demand.reject"
  | "incident.create"
  | "incident.view"
  | "incident.categorize"
  | "incident.assign"
  | "incident.transition"
  | "change.create"
  | "change.view"
  | "change.edit"
  | "change.review"
  | "change.submit_for_approval"
  | "change.approve.technical"
  | "change.approve.business"
  | "change.schedule"
  | "change.transition"
  | "change.pir"
  | "comment.create"
  | "comment.view.internal"
  | "audit.view"
  | "audit.export"
  | "notification.view.own";

export const ACTIONS = [
  "demand.create",
  "demand.view",
  "demand.score.value",
  "demand.score.effort",
  "demand.decide",
  "demand.convert",
  "demand.reject",
  "incident.create",
  "incident.view",
  "incident.categorize",
  "incident.assign",
  "incident.transition",
  "change.create",
  "change.view",
  "change.edit",
  "change.review",
  "change.submit_for_approval",
  "change.approve.technical",
  "change.approve.business",
  "change.schedule",
  "change.transition",
  "change.pir",
  "comment.create",
  "comment.view.internal",
  "audit.view",
  "audit.export",
  "notification.view.own",
] as const satisfies readonly Action[];

// Compile-time guard: `ACTIONS` must list every member of the `Action` union.
// `satisfies` above already rejects a stray non-`Action` entry; this rejects a
// missing one. If an `Action` is absent from the array, `MissingActions` is not
// `never` and the annotation below fails to typecheck.
type MissingActions = Exclude<Action, (typeof ACTIONS)[number]>;
const _actionsAreExhaustive: [MissingActions] extends [never]
  ? true
  : MissingActions = true;
void _actionsAreExhaustive;
