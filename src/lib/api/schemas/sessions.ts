import { z } from "zod";

/**
 * Request / response contract for the session endpoints (Task 15).
 * `plans/DESIGN.md` §8 — every endpoint has Zod schemas here and the typed
 * client infers from them.
 *
 * These describe the **wire** shape. The routes serialise via
 * `NextResponse.json()`, which turns the `Date` columns Prisma returns into ISO
 * strings, so `createdAt` / `lastSeenAt` / `expires` are `z.iso.datetime()`
 * here, not `z.date()`. The pre-serialisation row types (with `Date`) live in
 * `src/server/auth/sessions.ts`.
 */

/** `GET /api/sessions` query. `all=1` is honoured only for a `TECHNICAL_APPROVER`
 *  and silently ignored for anyone else. */
export const sessionsQuery = z.object({
  all: z.literal("1").optional(),
});

/**
 * One session as shown to its owner, as it crosses the wire. `sessionToken`
 * (hashed or not) is never included.
 */
export const sessionListItem = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  expires: z.iso.datetime(),
});
export type SessionListItem = z.infer<typeof sessionListItem>;

/** The `?all=1` view for a session administrator — adds whose session it is. */
export const adminSessionListItem = sessionListItem.extend({
  userId: z.string(),
  user: z.object({ email: z.string(), displayName: z.string() }),
});
export type AdminSessionListItem = z.infer<typeof adminSessionListItem>;

export const sessionsResponse = z.object({
  // Admin variant first: it is a superset, so a plain row would also satisfy it
  // in the wrong order and lose `userId` / `user` on parse.
  sessions: z.array(z.union([adminSessionListItem, sessionListItem])),
});
export type SessionsResponse = z.infer<typeof sessionsResponse>;

/** Shared success body for `POST /api/auth/logout` and `DELETE /api/sessions/:id`. */
export const okResponse = z.object({ ok: z.literal(true) });
