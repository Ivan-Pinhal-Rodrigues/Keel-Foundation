import { NextResponse } from "next/server";
import { commentBody } from "@/lib/api/schemas/demands";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { addComment, listComments } from "@/server/modules/comment";
import {
  demandClientId,
  demandSubmitterInfo,
  getDemandForActor,
} from "@/server/modules/demand/service";
import { isInternal } from "@/server/policy/actor";
import { authorize } from "@/server/policy/authorize";

/**
 * `GET/POST /api/demands/:id/comments` — the demand drawer's comment thread
 * (`plans/plan-01-demand.md` Task 6).
 *
 * Both handlers run `getDemandForActor` first: it authorises the view and 404s a
 * guest reaching another client's demand. `demandClientId` then supplies the
 * `clientId` the guest-serialized demand omits, so the `CommentSubject` carries
 * the real value — the comment module runs `requireOwnClientOr404` on it
 * internally, so the ownership check is not repeated here. POST additionally
 * runs the `comment.create` action check and re-lists after the write
 * (`serializeComment` needs the author join — never hand-serialize one row).
 *
 * A dynamic segment cannot ride the `export const GET = withRequest(...)`
 * shorthand (see `src/app/api/demands/[id]/route.ts`).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    await getDemandForActor(actor, id);
    const clientId = await demandClientId(id);
    return NextResponse.json({
      comments: await listComments(actor, { type: "Demand", id, clientId }),
    });
  })(req);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    const { body, visibleToClient } = commentBody.parse(
      await req.json().catch(() => null),
    );
    const demand = await getDemandForActor(actor, id);
    const clientId = await demandClientId(id);
    authorize(actor, "comment.create", { type: "demand", id, clientId });

    // Notify the submitter — the "other party" — when they didn't author this
    // comment themselves. A GUEST submitter only learns of an internal-authored
    // thread when it is visible to them (`visibleToClient`); an INTERNAL
    // submitter is notified regardless, since that boundary only protects a
    // guest from learning an internal-only thread exists.
    const submitter = await demandSubmitterInfo(id);
    const effectiveVisibleToClient = isInternal(actor)
      ? (visibleToClient ?? false)
      : true;
    const notifyUserId =
      submitter &&
      submitter.id !== actor.id &&
      (submitter.kind !== "GUEST" || effectiveVisibleToClient)
        ? submitter.id
        : undefined;

    await runInTransaction((tx) =>
      addComment(tx, {
        actor,
        subject: { type: "Demand", id, clientId },
        body,
        visibleToClient,
        notifyUserId,
        notifySummary: notifyUserId
          ? `New message on your request "${demand.ref as string}"`
          : undefined,
      }),
    );
    return NextResponse.json(
      { comments: await listComments(actor, { type: "Demand", id, clientId }) },
      { status: 201 },
    );
  })(req);
}
