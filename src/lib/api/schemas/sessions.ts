import { z } from "zod";

/**
 * Request / response contract for the session endpoints (Task 15).
 * `plans/DESIGN.md` §8 — every endpoint has Zod schemas here and the typed
 * client infers from them.
 */

/** `GET /api/sessions` query. `all=1` is honoured only for a `TECHNICAL_APPROVER`
 *  and silently ignored for anyone else. */
export const sessionsQuery = z.object({
  all: z.literal("1").optional(),
});

/**
 * One session as shown to its owner. `sessionToken` (hashed or not) is never
 * included. `Date` fields serialise to ISO strings over the wire.
 */
export const sessionListItem = z.object({
  id: z.string(),
  createdAt: z.date(),
  lastSeenAt: z.date(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  expires: z.date(),
});
export type SessionListItem = z.infer<typeof sessionListItem>;

/** The `?all=1` view for a session administrator — adds whose session it is. */
export const adminSessionListItem = sessionListItem.extend({
  userId: z.string(),
  user: z.object({ email: z.string(), displayName: z.string() }),
});
export type AdminSessionListItem = z.infer<typeof adminSessionListItem>;

export const sessionsResponse = z.object({
  sessions: z.array(z.union([adminSessionListItem, sessionListItem])),
});
export type SessionsResponse = z.infer<typeof sessionsResponse>;

/** Shared success body for `POST /api/auth/logout` and `DELETE /api/sessions/:id`. */
export const okResponse = z.object({ ok: z.literal(true) });
