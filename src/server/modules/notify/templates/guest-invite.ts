import type { Template } from "./index";
import { escapeHtml, renderLayout } from "./layout";

/**
 * `guest_invite` — sent when an internal user invites a client contact to the
 * portal. Guest-facing, so the copy stays in plain words: no internal
 * vocabulary, no `ChangeStatus`, no internal user names (spec 05 §5).
 *
 * Payload: `{ clientName: string; url: string }` — `url` is the full redeem link
 * (`APP_URL` + `/portal/invite/<token>`), built by the caller.
 */
export const guestInvite: Template = (payload) => {
  const clientName =
    typeof payload.clientName === "string" && payload.clientName.length > 0
      ? payload.clientName
      : "your organisation";
  const url = typeof payload.url === "string" ? payload.url : "";

  const subject = "You have been invited to the Keel client portal";

  const text = [
    `${clientName} has invited you to the Keel client portal.`,
    "",
    "Open this link to set your password and sign in:",
    url,
    "",
    "The link expires in 7 days.",
  ].join("\n");

  const html = renderLayout({
    heading: "You have been invited to Keel",
    bodyHtml:
      `<p style="margin:0 0 12px;">${escapeHtml(clientName)} has invited you to the Keel client portal.</p>` +
      `<p style="margin:0;">The link below expires in 7 days.</p>`,
    ctaLabel: "Open the portal",
    ctaUrl: url,
  });

  return { subject, text, html };
};
