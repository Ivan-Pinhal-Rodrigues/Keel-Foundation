/**
 * Reduce a `?next=` query value to a safe same-site destination.
 *
 * The value is validated with the *same* parser (`new URL`) that Next's
 * `router.push` ultimately runs, so the check cannot disagree with the consumer.
 * A string-prefix guard does: `/%09//evil.com` decodes to `"/\t//evil.com"`,
 * which no `startsWith("//")` test catches, but `new URL` strips the tab and
 * resolves it to `https://evil.com/` — an external redirect right after login.
 *
 * Anything that resolves off-origin, or does not parse, falls back to
 * `/demands`. A same-origin value is returned as its path + query + hash only.
 */
// TODO(plan-06): the fallback destination becomes /overview once the dashboard
// ships.
const FALLBACK = "/demands";

export function sanitizeNext(raw: string | string[] | undefined): string {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (!candidate) return FALLBACK;
  try {
    const u = new URL(candidate, "https://keel.invalid");
    if (u.origin !== "https://keel.invalid") return FALLBACK;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return FALLBACK;
  }
}
