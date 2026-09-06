import { NextResponse } from "next/server";
import { incidentCommentBody } from "@/lib/api/schemas/incidents";
import { withRequest } from "@/lib/api/with-request";
import { getActor } from "@/server/auth/actor";
import { runInTransaction } from "@/server/db/tx";
import { addComment, listComments } from "@/server/modules/comment";
import {
  incidentClientId,
  getIncidentForActor,
} from "@/server/modules/incident/service";
import { authorize } from "@/server/policy/authorize";

/**
 * `GET/POST /api/incidents/:id/comments` — the incident drawer's comment thread
 * (`plans/plan-02-incident.md` Task 7).
 *
 * Both handlers run `getIncidentForActor` first: it authorises the view and 404s a
 * guest reaching another client's incident. `incidentClientId` then supplies the
 * `clientId` the guest-serialized incident omits, so the `CommentSubject` carries
 * the real value — the comment module runs `requireOwnClientOr404` on it
 * internally, so the ownership check is not repeated here. POST additionally
 * runs the `comment.create` action check and re-lists after the write
 * (`serializeComment` needs the author join — never hand-serialize one row).
 *
 * A dynamic segment cannot ride the `export const GET = withRequest(...)`
 * shorthand (see `src/app/api/incidents/[id]/route.ts`).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return withRequest(async (): Promise<Response> => {
    const actor = await getActor();
    await getIncidentForActor(actor, id);
    const clientId = await incidentClientId(id);
    return NextResponse.json({
      comments: await listComments(actor, { type: "Incident", id, clientId }),
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
    const { body, visibleToClient } = incidentCommentBody.parse(
      await req.json().catch(() => null),
    );
    await getIncidentForActor(actor, id);
    const clientId = await incidentClientId(id);
    authorize(actor, "comment.create", { type: "incident", id, clientId });
    await runInTransaction((tx) =>
      addComment(tx, {
        actor,
        subject: { type: "Incident", id, clientId },
        body,
        visibleToClient,
      }),
    );
    return NextResponse.json(
      {
        comments: await listComments(actor, { type: "Incident", id, clientId }),
      },
      { status: 201 },
    );
  })(req);
}
