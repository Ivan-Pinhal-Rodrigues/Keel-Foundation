import type { Rule } from "@/server/policy/rule";

/**
 * The `change.approve.*` steps — `plans/specs/00-foundation.md` §4.2 and
 * `plans/DESIGN.md` §3.4 (segregation of duties). Kept apart from the rest of
 * `change.*` because these are the CAB approval gates: hat-routed, risk-gated
 * (business), and blocked for the change owner with an `overrideAction` signal.
 *
 * Task 18 skeleton: both entries throw "not implemented" until Task 19.
 */
const notImplemented: Rule = () => {
  throw new Error("not implemented");
};

export const approvalRules = {
  "change.approve.technical": notImplemented,
  "change.approve.business": notImplemented,
} satisfies Record<string, Rule>;
