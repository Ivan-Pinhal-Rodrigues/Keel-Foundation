import { type Actor, isInternal } from "./actor";

export type SerializerConfig<T> = {
  internalOnlyKeys: readonly (keyof T)[];
  guestTransform?: (row: T) => Partial<T> & Record<string, unknown>;
};

/**
 * Denylist serializer. Internal shaping only — DO NOT use for guest output: it
 * spreads the whole row and then deletes an enumerated list, so a column added
 * later ships to guests by omission (and `assertNoInternalKeys` checks the same
 * list, so it cannot catch the un-listed leak). For anything a guest can see,
 * use `serializePick`, where a new column must not leak by omission.
 */
export function serializeFor<T extends Record<string, unknown>>(
  actor: Actor,
  row: T,
  cfg: SerializerConfig<T>,
): Record<string, unknown> {
  if (isInternal(actor)) return { ...row };
  const out: Record<string, unknown> = { ...row };
  for (const k of cfg.internalOnlyKeys) delete out[k as string];
  if (cfg.guestTransform) Object.assign(out, cfg.guestTransform(row));
  return out;
}

/**
 * Allowlist serializer for guest-visible output. An internal reader gets the
 * row as-is, minus any `internalOmit` keys (rare — e.g. a password hash). A
 * guest gets ONLY the keys named in `guestKeys`, then `guestTransform`'s result
 * merged over the top. A column added to the row later stays hidden from guests
 * until it is added to `guestKeys` — it cannot leak by omission.
 */
export function serializePick<T extends Record<string, unknown>>(
  actor: Actor,
  row: T,
  cfg: {
    guestKeys: readonly (keyof T)[];
    guestTransform?: (row: T) => Record<string, unknown>;
    internalOmit?: readonly (keyof T)[];
  },
): Record<string, unknown> {
  if (isInternal(actor)) {
    const out: Record<string, unknown> = { ...row };
    for (const k of cfg.internalOmit ?? []) delete out[k as string];
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k of cfg.guestKeys) out[k as string] = row[k];
  if (cfg.guestTransform) Object.assign(out, cfg.guestTransform(row));
  return out;
}

export function assertNoInternalKeys(
  obj: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const k of keys) {
    if (k in obj) throw new Error(`internal-only key leaked to guest: ${k}`);
  }
}
