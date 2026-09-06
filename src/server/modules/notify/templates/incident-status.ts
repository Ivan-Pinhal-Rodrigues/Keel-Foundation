import type { Template } from "./index";
import { escapeHtml, renderLayout } from "./layout";

/**
 * `incident_status` — sent to a guest reporter when their incident's status
 * moves. Guest-facing, so the copy stays in plain words (spec 02 §6 status
 * vocabulary): no internal terms, no `IncidentStatus`, no internal user names.
 *
 * Payload: `{ ref: string; status: string }` — `status` is the already-rendered
 * plain-word phrase from `guestIncidentStatusLabel` ("Reported",
 * "Investigating", "Resolved", "Closed"). The CTA points at the portal incident
 * list; `APP_URL` is read here (as `demand-decided.ts` does) rather than passed
 * in the payload.
 */
export const incidentStatus: Template = (payload) => {
  const ref =
    typeof payload.ref === "string" && payload.ref.length > 0
      ? payload.ref
      : "your report";
  const status =
    typeof payload.status === "string" && payload.status.length > 0
      ? payload.status
      : "updated";
  const ctaUrl = `${process.env.APP_URL ?? ""}/portal/incidents`;

  const subject = `Update on ${ref}: ${status}`;

  const text = [
    `There is an update on your report ${ref}.`,
    "",
    `Current status: ${status}`,
    "",
    "Sign in to the portal to see the details or add a comment:",
    ctaUrl,
  ].join("\n");

  const html = renderLayout({
    heading: `Update on ${ref}`,
    bodyHtml:
      `<p style="margin:0 0 12px;">There is an update on your report ${escapeHtml(ref)}.</p>` +
      `<p style="margin:0;">Current status: <strong>${escapeHtml(status)}</strong></p>`,
    ctaLabel: "Open the portal",
    ctaUrl,
  });

  return { subject, text, html };
};
