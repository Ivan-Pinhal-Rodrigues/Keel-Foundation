import type { Template } from "./index";
import { escapeHtml, renderLayout } from "./layout";

/**
 * `demand_decided` — sent to a guest submitter when their demand reaches a
 * worth decision or is declined. Guest-facing, so the copy stays in plain words
 * (spec 01 §5 status vocabulary): no internal terms, no `DemandStatus`, no
 * internal user names.
 *
 * Payload: `{ ref: string; status: string }` — `status` is the already-rendered
 * plain-word phrase from `guestStatusLabel` ("Approved", "In review",
 * "Declined — <reason>"). The CTA points at the portal list; `APP_URL` is read
 * here (as `auth/invites.ts` does) rather than passed in the payload.
 */
export const demandDecided: Template = (payload) => {
  const ref =
    typeof payload.ref === "string" && payload.ref.length > 0
      ? payload.ref
      : "your request";
  const status =
    typeof payload.status === "string" && payload.status.length > 0
      ? payload.status
      : "updated";
  const ctaUrl = `${process.env.APP_URL ?? ""}/portal/demands`;

  const subject = `Update on ${ref}: ${status}`;

  const text = [
    `There is an update on your request ${ref}.`,
    "",
    `Current status: ${status}`,
    "",
    "Sign in to the portal to see the details or add a comment:",
    ctaUrl,
  ].join("\n");

  const html = renderLayout({
    heading: `Update on ${ref}`,
    bodyHtml:
      `<p style="margin:0 0 12px;">There is an update on your request ${escapeHtml(ref)}.</p>` +
      `<p style="margin:0;">Current status: <strong>${escapeHtml(status)}</strong></p>`,
    ctaLabel: "Open the portal",
    ctaUrl,
  });

  return { subject, text, html };
};
