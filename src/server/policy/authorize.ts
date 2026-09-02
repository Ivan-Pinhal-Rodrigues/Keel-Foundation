/**
 * `authorize(actor, action, subject)` — the policy engine. Returns on allow,
 * throws on deny. Deny by default: an action with no rule falls through to
 * `ForbiddenError`.
 *
 * `plans/specs/00-foundation.md` §4, `plans/DESIGN.md` §8 (frozen contract).
 * The rule for each action is a pure `Rule` function; per-subject groups live
 * in `subjects/*.rule.ts`, sharing the predicates in `subjects/helpers.ts`.
 * Thrown errors map to HTTP in `src/lib/api/errors.ts`: `ForbiddenError` → 403,
 * `NotFoundError` → 404, `SegregationError` → 409 (with `overrideAction`).
 */
import type { Actor } from "@/server/policy/actor";
import type { Action } from "@/server/policy/actions";
import { ForbiddenError } from "@/server/policy/errors";
import type { Rule } from "@/server/policy/rule";
import type { Subject } from "@/server/policy/subjects/types";
import { approvalRules } from "@/server/policy/subjects/approval.rule";
import { auditRules } from "@/server/policy/subjects/audit.rule";
import { changeRules, changeView } from "@/server/policy/subjects/change.rule";
import { demandRules, demandView } from "@/server/policy/subjects/demand.rule";
import {
  incidentRules,
  incidentView,
} from "@/server/policy/subjects/incident.rule";
import { requireInternal } from "@/server/policy/subjects/helpers";

/**
 * `comment.create` — "any actor on a subject they can view" (spec §8). Defer to
 * the view rule for the subject's own type; a subject with no view rule (none /
 * audit / approvalStep) cannot be commented on.
 */
const commentCreate: Rule = (actor, subject) => {
  switch (subject.type) {
    case "demand":
      return demandView(actor, subject);
    case "incident":
      return incidentView(actor, subject);
    case "change":
      return changeView(actor, subject);
    default:
      throw new ForbiddenError(
        "a comment needs a demand, incident, or change subject",
      );
  }
};

const RULES: Record<Action, Rule> = {
  ...demandRules,
  ...incidentRules,
  ...changeRules,
  ...approvalRules,
  ...auditRules,
  "comment.create": commentCreate,
  "comment.view.internal": (actor) => requireInternal(actor),
  "notification.view.own": () => {},
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
