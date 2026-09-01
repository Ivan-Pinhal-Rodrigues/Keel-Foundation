/**
 * `authorize(actor, action, subject)` — the policy engine. Returns on allow,
 * throws on deny. Deny by default: an action with no rule falls through to
 * `ForbiddenError`.
 *
 * `plans/specs/00-foundation.md` §4, `plans/DESIGN.md` §8 (frozen contract).
 * The rule for each action is a pure `Rule` function; per-subject groups live
 * in `subjects/*.rule.ts`.
 *
 * Task 18 (skeleton): the trivial always-allow and internal-only actions are
 * wired here; every per-subject action dispatches to a `subjects/*.rule.ts`
 * stub that throws "not implemented" until Task 19.
 */
import { isInternal, type Actor } from "@/server/policy/actor";
import type { Action } from "@/server/policy/actions";
import { ForbiddenError } from "@/server/policy/errors";
import type { Rule } from "@/server/policy/rule";
import type { Subject } from "@/server/policy/subjects/types";
import { approvalRules } from "@/server/policy/subjects/approval.rule";
import { changeRules } from "@/server/policy/subjects/change.rule";
import { demandRules } from "@/server/policy/subjects/demand.rule";
import { incidentRules } from "@/server/policy/subjects/incident.rule";

/** Any authenticated actor — `GUEST | INTERNAL`. */
const allowAny: Rule = () => {};

/** Internal users only; a guest is forbidden (not 404 — these subjects are not
 *  client-scoped, so their existence is not a secret). */
const internalOnly: Rule = (actor) => {
  if (!isInternal(actor)) {
    throw new ForbiddenError("internal users only");
  }
};

const notImplemented: Rule = () => {
  throw new Error("not implemented");
};

const RULES: Record<Action, Rule> = {
  ...demandRules,
  ...incidentRules,
  ...changeRules,
  ...approvalRules,
  // --- trivial cases, wired inline for the Task 18 skeleton ---
  "demand.create": allowAny,
  "incident.create": allowAny,
  "notification.view.own": allowAny,
  "change.view": internalOnly,
  "comment.view.internal": internalOnly,
  "audit.view": internalOnly,
  "audit.export": internalOnly,
  // filled in by Task 19 (delegates to the viewable subject's rule)
  "comment.create": notImplemented,
};

export function authorize(
  actor: Actor,
  action: Action,
  subject: Subject,
): void {
  const rule = (RULES as Record<string, Rule | undefined>)[action];
  if (!rule) {
    throw new ForbiddenError(`policy: no rule for action "${String(action)}"`);
  }
  rule(actor, subject);
}
