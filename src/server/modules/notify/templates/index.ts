import { demandDecided } from "./demand-decided";
import { guestInvite } from "./guest-invite";
import { incidentStatus } from "./incident-status";

/**
 * The email template registry (spec 05 §5).
 *
 * A template is a pure function `payload -> { subject, text, html }`. Phase 0
 * shipped `guest_invite`; `demand_decided` arrives with plan-01 Task 4;
 * `incident_status` with plan-02 Task 6. The rest arrive with their trigger
 * wiring later.
 */

export type Rendered = { subject: string; text: string; html: string };
export type Template = (payload: Record<string, unknown>) => Rendered;

export const templates: Record<string, Template> = {
  guest_invite: guestInvite,
  demand_decided: demandDecided,
  incident_status: incidentStatus,
};

export function renderTemplate(
  name: string,
  payload: Record<string, unknown>,
): Rendered {
  const template = templates[name];
  if (!template) throw new Error(`unknown template: ${name}`);
  return template(payload);
}
