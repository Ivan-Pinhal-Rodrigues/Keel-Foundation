import { type Actor, isInternal } from "./actor";
import { NotFoundError } from "./errors";

export function scopeToClient(
  actor: Actor,
): { clientId: string } | Record<string, never> {
  return actor.kind === "GUEST" && actor.clientId != null
    ? { clientId: actor.clientId }
    : {};
}

export function assertVisibleToGuest(
  actor: Actor,
  row: { clientId: string | null } | null,
): void {
  if (isInternal(actor)) return;
  if (row == null || row.clientId == null || row.clientId !== actor.clientId) {
    throw new NotFoundError("not found");
  }
}
