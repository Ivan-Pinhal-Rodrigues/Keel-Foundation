import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "@/server/policy/actor";

// `actor` is the full Actor `withRequest` has already resolved for this request
// (type-only import — erased at compile time, so no runtime dependency on the
// policy layer). It lets `getActor()` answer without a second DB round-trip. A
// context opened by hand (the login route) leaves it undefined.
type Ctx = { requestId: string; actorId?: string | null; actor?: Actor | null };
const als = new AsyncLocalStorage<Ctx>();

export const runWithContext = <T>(ctx: Ctx, fn: () => Promise<T>) =>
  als.run(ctx, fn);
export function getRequestId(): string {
  const c = als.getStore();
  if (!c) throw new Error("no request context");
  return c.requestId;
}
export const getActorId = (): string | null => als.getStore()?.actorId ?? null;
export function setActorId(id: string) {
  const c = als.getStore();
  if (c) c.actorId = id;
}

/** The Actor `withRequest` stashed for this request, or `null` if none was
 *  resolved / the context was opened without one. `getActor()` prefers this. */
export const getContextActor = (): Actor | null =>
  als.getStore()?.actor ?? null;
