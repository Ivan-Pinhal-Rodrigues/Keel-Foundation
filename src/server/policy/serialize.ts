import { Actor, isInternal } from "./actor";

export type SerializerConfig<T> = {
  internalOnlyKeys: readonly (keyof T)[];
  guestTransform?: (row: T) => Partial<T> & Record<string, unknown>;
};

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

export function assertNoInternalKeys(
  obj: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const k of keys) {
    if (k in obj) throw new Error(`internal-only key leaked to guest: ${k}`);
  }
}
