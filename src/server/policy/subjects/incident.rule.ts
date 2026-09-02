/**
 * `incident.*` authorisation rules — `plans/specs/00-foundation.md` §4.2.
 *
 *   incident.create      GUEST | INTERNAL
 *   incident.view        owner-guest (same client) | INTERNAL
 *   incident.categorize  INTERNAL (DEVELOPER)
 *   incident.assign      INTERNAL (DEVELOPER)
 *   incident.transition  INTERNAL (DEVELOPER)
 */
import type { Rule } from "@/server/policy/rule";
import {
  asIncident,
  requireHat,
  requireOwnClientOr404,
} from "@/server/policy/subjects/helpers";

/** An internal user always; a guest only for their own client's incident
 *  (`requireOwnClientOr404` passes every internal actor through). */
export const incidentView: Rule = (actor, subject) =>
  requireOwnClientOr404(actor, asIncident(subject)?.clientId);

export const incidentRules = {
  "incident.create": () => {},
  "incident.view": incidentView,
  "incident.categorize": (actor) => requireHat(actor, "DEVELOPER"),
  "incident.assign": (actor) => requireHat(actor, "DEVELOPER"),
  "incident.transition": (actor) => requireHat(actor, "DEVELOPER"),
} satisfies Record<string, Rule>;
