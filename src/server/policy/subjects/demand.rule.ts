import type { Rule } from "@/server/policy/rule";

/**
 * `demand.*` authorisation rules — `plans/specs/00-foundation.md` §4.2.
 *
 * Task 18 skeleton: every entry throws "not implemented" until Task 19 supplies
 * the real rule (and `subjects/helpers.ts`). `authorize` overrides the trivial
 * `demand.create` case inline for the skeleton, so this stub does not block it.
 */
const notImplemented: Rule = () => {
  throw new Error("not implemented");
};

export const demandRules = {
  "demand.create": notImplemented,
  "demand.view": notImplemented,
  "demand.score.value": notImplemented,
  "demand.score.effort": notImplemented,
  "demand.decide": notImplemented,
  "demand.convert": notImplemented,
  "demand.reject": notImplemented,
} satisfies Record<string, Rule>;
