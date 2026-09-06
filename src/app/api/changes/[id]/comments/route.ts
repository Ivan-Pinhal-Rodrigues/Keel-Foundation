import { NextResponse } from "next/server";
import { changeCommentBody } from "@/lib/api/schemas/changes";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { addComment, listComments } from "@/server/modules/comment";
import { getChangeForActor } from "@/server/modules/change/service";
import { authorize } from "@/server/policy/authorize";

/**
 * `GET/POST /api/changes/:id/comments` — the change drawer's review thread
 * (`plans/plan-03-change-approvals` Task 13). This mirrors the incident comments
 * route, with two differences a `Change` subject forces:
 *
 *   - A `Change` `CommentSubject` is `{ type: "Change", id }` with **no
 *     clientId** (CONTRACTS §4) — a change is internal-only, so there is no
 *     per-client ownership to carry. `getChangeForActor` runs `requireInternal`
 *     first, so a guest reaching here gets a flat 403 (plan ruling P3).
 *   - The POST is gated on `change.review` — the REVIEWER hat — not
 *     `comment.create`. Review is advisory and never gates a transition.
 *
 * `serializeComment` needs the author join, so POST re-lists after the write
 * rather than hand-serializing the new row.
 *
 * A dynamic segment cannot ride the `export const GET = withRequest(...)`
 * shorthand (see `src/app/api/changes/[id]/route.ts`).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    await getChangeForActor(actor, id);
    return NextResponse.json({
      comments: await listComments(actor, { type: "Change", id }),
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
    const { body } = changeCommentBody.parse(
      await req.json().catch(() => null),
    );
    await getChangeForActor(actor, id);
    authorize(actor, "change.review", { type: "change", id });
    await runInTransaction((tx) =>
      addComment(tx, {
        actor,
        subject: { type: "Change", id },
        body,
        visibleToClient: false,
      }),
    );
    return NextResponse.json(
      { comments: await listComments(actor, { type: "Change", id }) },
      { status: 201 },
    );
  })(req);
}
