import type { Rule } from "@/server/policy/rule";

/**
 * `change.*` authorisation rules, except the two `change.approve.*` steps which
 * live in `approval.rule.ts` — `plans/specs/00-foundation.md` §4.2.
 *
 * Task 18 skeleton: every entry throws "not implemented" until Task 19 supplies
 * the real rule. `authorize` overrides the trivial `change.view` (internal
 * only, never guest) case inline for the skeleton.
 */
const notImplemented: Rule = () => {
  throw new Error("not implemented");
};

export const changeRules = {
  "change.create": notImplemented,
  "change.view": notImplemented,
  "change.edit": notImplemented,
  "change.review": notImplemented,
  "change.submit_for_approval": notImplemented,
  "change.schedule": notImplemented,
  "change.transition": notImplemented,
  "change.pir": notImplemented,
} satisfies Record<string, Rule>;
