/**
 * `change.*` authorisation rules, except the two `change.approve.*` steps which
 * live in `approval.rule.ts` — `plans/specs/00-foundation.md` §4.2.
 *
 *   change.create               INTERNAL (DEVELOPER)
 *   change.view                  INTERNAL          (never GUEST)
 *   change.edit                  change owner | INTERNAL (DEVELOPER)
 *   change.review                REVIEWER
 *   change.submit_for_approval   change owner
 *   change.schedule              INTERNAL (DEVELOPER)
 *   change.transition            INTERNAL (DEVELOPER)
 *   change.pir                   BUSINESS_APPROVER | TECHNICAL_APPROVER
 *
 * `change.submit_for_approval` additionally requires a rollback plan on the
 * change — a state-machine precondition enforced by the change service at the
 * transition, not here (the `Subject` does not carry `rollbackPlan`).
 */
import { hasHat } from "@/server/policy/actor";
import { ForbiddenError } from "@/server/policy/errors";
import type { Rule } from "@/server/policy/rule";
import {
  asChange,
  requireAnyHat,
  requireHat,
  requireInternal,
} from "@/server/policy/subjects/helpers";

/** Internal only — the change register is never a guest surface. */
export const changeView: Rule = (actor) => requireInternal(actor);

export const changeRules = {
  "change.create": (actor) => requireHat(actor, "DEVELOPER"),
  "change.view": changeView,
  "change.edit": (actor, subject) => {
    requireInternal(actor);
    if (hasHat(actor, "DEVELOPER")) return;
    const change = asChange(subject);
    if (change && change.ownerId != null && change.ownerId === actor.id) return;
    throw new ForbiddenError("the change owner or a DEVELOPER only");
  },
  "change.review": (actor) => requireHat(actor, "REVIEWER"),
  "change.submit_for_approval": (actor, subject) => {
    requireInternal(actor);
    const change = asChange(subject);
    if (!change || change.ownerId == null || change.ownerId !== actor.id) {
      throw new ForbiddenError("the change owner only");
    }
  },
  "change.schedule": (actor) => requireHat(actor, "DEVELOPER"),
  "change.transition": (actor) => requireHat(actor, "DEVELOPER"),
  "change.pir": (actor) =>
    requireAnyHat(actor, ["BUSINESS_APPROVER", "TECHNICAL_APPROVER"]),
} satisfies Record<string, Rule>;
