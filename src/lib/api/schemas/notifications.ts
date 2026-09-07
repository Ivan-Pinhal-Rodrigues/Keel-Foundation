import { z } from "zod";

/**
 * Request contracts for the notification endpoints (`plan-04` Task 2).
 * `KINDS` is duplicated from `prisma/schema.prisma`'s `NotificationKind` — the
 * same tradeoff the demand schemas take.
 */

const KINDS = [
  "ASSIGNED",
  "APPROVAL_NEEDED",
  "STATUS_CHANGED",
  "COMMENTED",
  "OVERDUE",
] as const;

/** The `NotificationKind` values, for a filter `<select>` on the client. */
export const NOTIFICATION_KINDS = KINDS;
export type NotificationKind = (typeof KINDS)[number];

/**
 * `GET /api/notifications` query string. `unread` arrives as the literal string
 * `"true"` / `"false"` (query params are always strings) and is folded to a
 * boolean — an absent param becomes `false`.
 */
export const listNotificationsQuery = z.object({
  unread: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  kind: z.enum(KINDS).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;

/**
 * `POST /api/notifications/read` body — either `{ all: true }` or a non-empty
 * list of ids (capped at 200). A bare `{}` matches neither member and fails as
 * a `ZodError` → 400.
 */
export const markReadBody = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }),
]);
export type MarkReadBody = z.infer<typeof markReadBody>;
