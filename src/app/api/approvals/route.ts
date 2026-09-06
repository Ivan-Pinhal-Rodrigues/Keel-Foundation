import { NextResponse } from "next/server";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { listApprovalsForActor } from "@/server/modules/approval/service";
import { requireInternal } from "@/server/policy/subjects/helpers";

/**
 * `GET /api/approvals` — the approvals awaiting the current actor: every PENDING
 * request whose current step's hat they hold. No dedicated policy action — a
 * plain internal-only gate (a guest → 403). `plans/plan-03-change-approvals`
 * Task 8.
 */
export const GET = withRequest(async (): Promise<Response> => {
  const actor = await getActor();
  requireInternal(actor);
  return NextResponse.json({ approvals: await listApprovalsForActor(actor) });
});
