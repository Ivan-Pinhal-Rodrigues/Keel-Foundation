import { NextResponse } from "next/server";
import { commentBody } from "@/lib/api/schemas/demands";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { addComment, listComments } from "@/server/modules/comment";
import {
  demandClientId,
  getDemandForActor,
} from "@/server/modules/demand/service";
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
    await getDemandForActor(actor, id);
    const clientId = await demandClientId(id);
    authorize(actor, "comment.create", { type: "demand", id, clientId });
    await runInTransaction((tx) =>
      addComment(tx, {
        actor,
        subject: { type: "Demand", id, clientId },
        body,
        visibleToClient,
      }),
    );
    return NextResponse.json(
      { comments: await listComments(actor, { type: "Demand", id, clientId }) },
      { status: 201 },
    );
  })(req);
}
