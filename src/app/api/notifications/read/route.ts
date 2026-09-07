import { NextResponse } from "next/server";
import { markReadBody } from "@/lib/api/schemas/notifications";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { markRead } from "@/server/modules/notify/read";
import { authorize } from "@/server/policy/authorize";

/**
 * `POST /api/notifications/read` — mark the actor's notifications read, either a
 * list of ids or `{ all: true }`. No transaction: `markRead` is one `updateMany`
 * with no audit event, so there is nothing to make atomic (plan ruling P1).
 * `plan-04` Task 2.
 */

export const POST = withRequest(async (req): Promise<Response> => {
  const actor = await getActor();
  authorize(actor, "notification.view.own", { type: "none" });
  const body = markReadBody.parse(await req.json().catch(() => null));
  return NextResponse.json(await markRead(actor, body));
});
