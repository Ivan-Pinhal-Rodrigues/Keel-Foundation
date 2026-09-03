import { type Actor, isInternal } from "./actor";
import { NotFoundError } from "./errors";

export function scopeToClient(
  actor: Actor,
): { clientId: string } | Record<string, never> {
  if (actor.kind !== "GUEST") return {};
  // A guest must always have a clientId (enforced by a DB CHECK constraint). If
  // one somehow does not, fail closed: an impossible clientId matches no rows,
  // rather than {} which would match every row.
  return { clientId: actor.clientId ?? " __no_such_client__" };
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
