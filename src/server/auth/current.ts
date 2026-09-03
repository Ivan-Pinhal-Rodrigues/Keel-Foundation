import { cache } from "react";
import { cookies } from "next/headers";
import type { $Enums } from "@prisma/client";
import { SESSION_COOKIE } from "@/lib/http/cookies";
import { getSessionAndUser } from "@/server/auth/session";
import type { Actor } from "@/server/policy/actor";

/**
 * Actor resolution for React Server Components and layouts.
 *
 * `getActor()` / `getActorOrNull()` (`@/server/auth/actor`) read the request
 * context that only `withRequest` populates. Next 15 does not run RSC renders
 * inside that context, so in any `async` layout or page they always see no
 * actor. These two functions instead read the session cookie directly through
 * `next/headers` and resolve it against the database.
 *
 * API-route-only rule still holds the other way: do NOT call these from an
 * `api/**` route — those go through `withRequest` and `getActor()`.
 */

export type Me = {
  id: string;
  kind: $Enums.UserKind;
  hats: $Enums.Hat[];
  clientId: string | null;
  displayName: string;
  email: string;
};

// `cache` dedupes the session read within a single RSC render pass: a layout
// that calls both `getCurrentActor()` (guard) and `whoami()` (display) — as
// `(internal)/layout.tsx` does — pays for one `getSessionAndUser`, not two.
// Outside a render (API routes never call these; tests) `cache` is a transparent
// no-op, so each call still resolves fresh.
const resolve = cache(async (): Promise<{ user: Me } | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await getSessionAndUser(token);
  // `getSessionAndUser` already returns null for a deactivated user or an
  // expired session; the `!s.user.isActive` guard is belt-and-braces.
  if (!s || !s.user.isActive) return null;
  const { id, kind, hats, clientId, displayName, email } = s.user;
  return { user: { id, kind, hats, clientId, displayName, email } };
});

/** The current request's actor, for server components and layouts. Returns
 *  `null` (never throws) when there is no usable session. Do NOT use in an
 *  `api/**` route — those use `getActor()` inside `withRequest`. */
export async function getCurrentActor(): Promise<Actor | null> {
  const r = await resolve();
  if (!r) return null;
  const { id, kind, hats, clientId } = r.user;
  return { id, kind, hats, clientId };
}

/** Like `getCurrentActor` but with `displayName` + `email` for the AppShell
 *  user block. Server components / layouts only. */
export async function whoami(): Promise<Me | null> {
  return (await resolve())?.user ?? null;
}
