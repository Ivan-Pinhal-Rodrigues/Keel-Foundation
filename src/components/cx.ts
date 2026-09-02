/**
 * Join truthy class-name fragments with a single space.
 *
 * CSS Modules are typed as `{ readonly [key: string]: string }`, and the repo
 * enables `noUncheckedIndexedAccess`, so `styles.foo` / `styles[key]` widen to
 * `string | undefined`. `cx` accepts those (and `false` / `null` from inline
 * conditionals) and drops the falsy ones.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
