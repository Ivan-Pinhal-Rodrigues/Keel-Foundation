import { NextResponse } from "next/server";
import { listNotificationsQuery } from "@/lib/api/schemas/notifications";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { listNotifications, unreadCount } from "@/server/modules/notify/read";
import { authorize } from "@/server/policy/authorize";

/**
 * `GET /api/notifications` — the bell menu. Scoped to the actor's own rows by
 * `notify/read.ts` (a user physically cannot address another user's rows), so
 * the `notification.view.own` call is the formality plus the audit trail of who
 * was allowed. A GUEST legitimately has notifications (the portal bell), so
 * there is no `requireInternal` here — a guest gets 200 with their own rows.
 * `plan-04` Task 2.
 */

export const GET = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  authorize(actor, "notification.view.own", { type: "none" });
  const filters = listNotificationsQuery.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  const [notifications, unread] = await Promise.all([
    listNotifications(actor, filters),
    unreadCount(actor),
  ]);
  return NextResponse.json({ notifications, unreadCount: unread });
});
