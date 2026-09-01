import type { Rule } from "@/server/policy/rule";

/**
 * `incident.*` authorisation rules — `plans/specs/00-foundation.md` §4.2.
 *
 * Task 18 skeleton: every entry throws "not implemented" until Task 19 supplies
 * the real rule. `authorize` overrides the trivial `incident.create` case
 * inline for the skeleton.
 */
const notImplemented: Rule = () => {
  throw new Error("not implemented");
};

export const incidentRules = {
  "incident.create": notImplemented,
  "incident.view": notImplemented,
  "incident.categorize": notImplemented,
  "incident.assign": notImplemented,
  "incident.transition": notImplemented,
} satisfies Record<string, Rule>;
