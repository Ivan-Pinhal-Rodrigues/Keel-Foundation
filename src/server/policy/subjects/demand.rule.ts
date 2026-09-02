/**
 * `demand.*` authorisation rules — `plans/specs/00-foundation.md` §4.2.
 *
 *   demand.create        GUEST | INTERNAL
 *   demand.view          owner-guest (same client) | INTERNAL
 *   demand.score.value   BUSINESS_APPROVER
 *   demand.score.effort  TECHNICAL_APPROVER
 *   demand.decide        BUSINESS_APPROVER | TECHNICAL_APPROVER   (SoD: not the submitter)
 *   demand.convert       BUSINESS_APPROVER | TECHNICAL_APPROVER
 *   demand.reject        BUSINESS_APPROVER | TECHNICAL_APPROVER
 */
import type { Rule } from "@/server/policy/rule";
import {
  asDemand,
  requireAnyHat,
  requireHat,
  requireNotSubmitter,
  requireOwnClientOr404,
} from "@/server/policy/subjects/helpers";

const WORTH_DECIDERS = ["BUSINESS_APPROVER", "TECHNICAL_APPROVER"] as const;

/** An internal user always; a guest only for their own client's demand
 *  (`requireOwnClientOr404` passes every internal actor through). */
export const demandView: Rule = (actor, subject) =>
  requireOwnClientOr404(actor, asDemand(subject)?.clientId);

export const demandRules = {
  "demand.create": () => {},
  "demand.view": demandView,
  "demand.score.value": (actor) => requireHat(actor, "BUSINESS_APPROVER"),
  "demand.score.effort": (actor) => requireHat(actor, "TECHNICAL_APPROVER"),
  "demand.decide": (actor, subject) => {
    requireAnyHat(actor, WORTH_DECIDERS);
    requireNotSubmitter(
      actor,
      asDemand(subject)?.submittedById,
      "demand.decide.override",
    );
  },
  "demand.convert": (actor) => requireAnyHat(actor, WORTH_DECIDERS),
  "demand.reject": (actor) => requireAnyHat(actor, WORTH_DECIDERS),
} satisfies Record<string, Rule>;
