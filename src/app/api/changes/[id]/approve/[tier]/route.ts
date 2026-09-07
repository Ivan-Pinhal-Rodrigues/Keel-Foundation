import { NextResponse } from "next/server";
import { recordDecisionBody } from "@/lib/api/schemas/approvals";
import { withRequest } from "@/lib/api/with-request";
import { writeAudit } from "@/server/audit/write";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { recordDecision } from "@/server/modules/approval/service";
import { changeApprovalContext } from "@/server/modules/change/service";
import { assertTransition } from "@/server/modules/change/state";
import { authorize } from "@/server/policy/authorize";
import {
  ConflictError,
  NotFoundError,
  SegregationError,
} from "@/server/policy/errors";
import { requireInternal } from "@/server/policy/subjects/helpers";

/**
 * `POST /api/changes/:id/approve/:tier` — a CAB approver records the decision on
 * the change's current approval step. `tier ∈ { technical, business }` picks the
 * policy action; anything else is a 404.
 *
 * `authorize` propagates untouched: a wrong hat / business-tier-on-non-HIGH →
 * `ForbiddenError` (403); the change owner with no justification →
 * `SegregationError` (409, carrying the override action). A resend with a
 * `>= 20`-char `overrideJustification` swallows only that SoD `SegregationError`
 * — `recordDecision` then enforces the hat + SoD itself and flags the override.
 * (The body is parsed before `authorize` so the override signal is known and a
 * malformed body is a 400, mirroring `decideDemand`'s route.)
 *
 * On REJECTED the change moves back `APPROVAL → ASSESSING` HERE, in the route's
 * transaction — `recordDecision` stays subject-agnostic (plan ruling P2) — but
 * ONLY when the change is actually still at `APPROVAL`. A retrospective REJECTED
 * decision on an EMERGENCY change that has already advanced past approval is
 * recorded by `recordDecision` and the change is left where it is (the `pir`
 * gate's "retrospective decision resolved" check covers that case). On APPROVED
 * the change stays at APPROVAL; the Schedule panel + `scheduleChange` perform the
 * next transition (Task 7).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; tier: string }> },
): Promise<Response> {
  const { id, tier } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    // Gate before any DB read: a change is invisible to guests (spec 03), so an
    // unauthorized caller must get a bare 403 — never a 404/409 that would
    // disclose the change's existence or approval state.
    requireInternal(actor);
    const ctx = await changeApprovalContext(id);
    if (!ctx.currentStepId) {
      throw new ConflictError("no approval step is awaiting a decision");
    }
    const action =
      tier === "technical"
        ? "change.approve.technical"
        : tier === "business"
          ? "change.approve.business"
          : null;
    if (!action) throw new NotFoundError("unknown approval tier");

    const body = recordDecisionBody.parse(await req.json().catch(() => null));
    const hasOverride = (body.overrideJustification?.trim().length ?? 0) >= 20;
    try {
      authorize(actor, action, {
        type: "change",
        id,
        ownerId: ctx.ownerId,
        riskLevel: ctx.riskLevel ?? undefined,
      });
    } catch (e) {
      // The owner may self-approve with a justification; `recordDecision`
      // enforces the hat and re-checks SoD, flagging the single-approver
      // override. Any other denial (wrong hat, business tier on a non-HIGH
      // change) still propagates.
      if (!(e instanceof SegregationError && hasOverride)) throw e;
    }
    await runInTransaction(async (tx) => {
      const { requestStatus } = await recordDecision(tx, {
        stepId: ctx.currentStepId!,
        actor,
        decision: body.decision,
        reason: body.reason,
        overrideJustification: body.overrideJustification,
      });
      if (requestStatus === "REJECTED" && ctx.status === "APPROVAL") {
        assertTransition("APPROVAL", "ASSESSING");
        await tx.change.update({
          where: { id },
          data: { status: "ASSESSING" },
        });
        await writeAudit(tx, {
          actorId: actor.id,
          action: "change.advanced",
          subjectType: "Change",
          subjectId: id,
          payload: {
            from: "APPROVAL",
            to: "ASSESSING",
            reason: "approval rejected",
          },
        });
      }
    });

    return NextResponse.json({ ok: true });
  })(req);
}
