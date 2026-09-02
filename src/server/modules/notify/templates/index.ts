import { guestInvite } from "./guest-invite";

/**
 * The email template registry (spec 05 §5).
 *
 * A template is a pure function `payload -> { subject, text, html }`. Phase 0
 * ships only `guest_invite`; the rest (`demand_status`, `incident_assigned`, …)
 * arrive with their trigger wiring in Phase 2.
 */

export type Rendered = { subject: string; text: string; html: string };
export type Template = (payload: Record<string, unknown>) => Rendered;

export const templates: Record<string, Template> = {
  guest_invite: guestInvite,
};

export function renderTemplate(
  name: string,
  payload: Record<string, unknown>,
): Rendered {
  const template = templates[name];
  if (!template) throw new Error(`unknown template: ${name}`);
  return template(payload);
}
