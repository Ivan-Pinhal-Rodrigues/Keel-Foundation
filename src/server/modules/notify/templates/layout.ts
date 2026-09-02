/**
 * The shared HTML shell for every Keel email (spec 05 §5).
 *
 * Deliberately minimal: one table-based layout with inline styles, the product
 * name, the message body, and a single call-to-action button. No tracking
 * pixels, no remote images, no web fonts — nothing that makes a network request
 * when the mail is opened.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape a string for safe interpolation into HTML text or an attribute. */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

export type LayoutOptions = {
  heading: string;
  /** Trusted HTML for the body — callers escape their own interpolations. */
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
};

export function renderLayout(opts: LayoutOptions): string {
  const heading = escapeHtml(opts.heading);
  const ctaLabel = escapeHtml(opts.ctaLabel);
  const ctaUrl = escapeHtml(opts.ctaUrl);

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f5f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:480px;background:#ffffff;border-radius:8px;padding:32px;">
            <tr>
              <td style="font-size:18px;font-weight:700;color:#00875a;padding-bottom:16px;">Keel</td>
            </tr>
            <tr>
              <td style="font-size:20px;font-weight:600;padding-bottom:12px;">${heading}</td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:1.5;">${opts.bodyHtml}</td>
            </tr>
            <tr>
              <td style="padding-top:24px;">
                <a href="${ctaUrl}" style="display:inline-block;background:#00875a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:6px;">${ctaLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="padding-top:24px;font-size:12px;color:#6b778c;line-height:1.5;">
                If the button does not work, copy this link into your browser:<br />
                ${ctaUrl}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
