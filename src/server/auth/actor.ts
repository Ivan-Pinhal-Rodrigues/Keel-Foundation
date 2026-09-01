import { getActorId, getContextActor } from "@/server/context";
import { prisma } from "@/server/db/client";
import type { PrismaTransaction } from "@/server/db/tx";
import type { Actor } from "@/server/policy/actor";

/**
 * Turning a user id into an `Actor`, and reading the current request's actor.
 *
 * `loadActor` is the one place a `User` row becomes an `Actor`. `withRequest`
 * builds the same shape inline from the session's included user and stashes it
 * on the context, so `getActor()` normally returns that without touching the
 * database; `loadActor` is the fallback (a context opened by hand) and the seam
 * the integration harness drives directly via the `client` argument.
 */

/** No usable actor: no session, or the user behind one is gone or deactivated.
 *  `withRequest`'s error mapper turns this into a 401. */
export class UnauthenticatedError extends Error {}

export async function loadActor(
  userId: string,
  client: PrismaTransaction = prisma,
): Promise<Actor> {
  const u = await client.user.findUnique({ where: { id: userId } });
  if (!u || !u.isActive) {
    throw new UnauthenticatedError("user not found or inactive");
  }
  return { id: u.id, kind: u.kind, hats: u.hats, clientId: u.clientId };
}

/** The current request's actor. Prefers the one `withRequest` stashed; otherwise
 *  loads it from `actorId` on the context. Throws `UnauthenticatedError` when
 *  there is no actor at all. */
export async function getActor(): Promise<Actor> {
  const stashed = getContextActor();
  if (stashed) return stashed;
  const id = getActorId();
  if (!id) throw new UnauthenticatedError("no actor in context");
  return loadActor(id);
}

/** Like `getActor` but `null` instead of throwing when unauthenticated. A
 *  genuine failure to load a known actor (e.g. the database is down) still
 *  propagates — only "there is no actor" is swallowed. */
export async function getActorOrNull(): Promise<Actor | null> {
  try {
    return await getActor();
  } catch (e) {
    if (e instanceof UnauthenticatedError) return null;
    throw e;
  }
}
