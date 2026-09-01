import { AsyncLocalStorage } from "node:async_hooks";

type Ctx = { requestId: string; actorId?: string | null };
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
