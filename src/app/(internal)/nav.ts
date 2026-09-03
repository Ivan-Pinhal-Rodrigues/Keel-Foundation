/**
 * Which nav item owns the current path, for the AppShell's `currentKey`.
 *
 * An item matches when the path is exactly its `href` or sits directly below it:
 * `/demands` and `/demands/42` both resolve to the `"demands"` key, while
 * `/demands-archive` resolves to `""` — a bare `startsWith` on the raw string
 * would wrongly claim that as a child. Every Phase 1 nav item rides on this, so
 * it is a plain pure function with its own test.
 */
export function navKeyFor(
  pathname: string,
  nav: readonly { key: string; href: string }[],
): string {
  return (
    nav.find(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    )?.key ?? ""
  );
}
