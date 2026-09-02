import type { Comment, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/server/audit/write";
import { prisma } from "@/server/db/client";
import type { PrismaTransaction } from "@/server/db/tx";
import { emitNotification } from "@/server/modules/notify/emit";
import { isInternal } from "@/server/policy/actor";
import type { Actor } from "@/server/policy/actor";
import { NotFoundError } from "@/server/policy/errors";
import { serializeComment, type SerializedComment } from "./serialize";

/**
 * The shared comment module (spec 00 §8) — used by the demand, incident, and
 * change drawers and by the guest portal.
 *
 * `subjectType` is stored capitalized ("Demand" | "Incident" | "Change"). The
 * caller is expected to have already run
 * `authorize(actor, "comment.create", subject)` (or the matching view check for
 * a list) — the guards here are a safety net, not the primary gate.
 *
 * `addComment` takes the caller's transaction first: the `Comment` row, the
 * `comment.created` audit event, and the optional `COMMENTED` notification all
 * commit or roll back together. `listComments` is a read, so it takes an
 * optional trailing `client` and defaults to the app singleton.
 *
 * The spec 00 §8 "notify the other party" duty is opt-in here: a notification
 * fires only when the call site passes `notifyUserId`. This module does not
 * work out who the other party is — the demand / incident / change service
 * that owns the subject knows its reporter / owner / assignee and passes the
 * id.
 */

export type CommentSubjectType = "Demand" | "Incident" | "Change";

/**
 * Create a comment on `subjectId`, audit it, and optionally notify one user.
 *
 * Returns the **raw, unserialized `Comment` row**. A route handler MUST pass it
 * through `serializeComment(actor, ...)` (or re-list via `listComments`) before
 * it reaches a response — never `Response.json(await addComment(...))`, which
 * would ship `authorId` and `visibleToClient` to a guest.
 */
export async function addComment(
  tx: PrismaTransaction,
  input: {
    actor: Actor;
    subjectType: CommentSubjectType;
    subjectId: string;
    body: string;
    /** Internal author's choice; default false. Ignored for guests — a guest
     *  author's comment is always forced visibleToClient = true. */
    visibleToClient?: boolean;
    notifyUserId?: string;
  },
): Promise<Comment> {
  const { actor, subjectType, subjectId, body } = input;

  // NOTE: the policy layer currently returns 403 (ForbiddenError) for
  // `comment.create` on a guest-invisible subject; Phase 1 route wiring should
  // prefer this module's 404 so a guest never learns a Change exists.
  if (!isInternal(actor) && subjectType === "Change") {
    throw new NotFoundError("not found");
  }

  const visibleToClient = isInternal(actor)
    ? (input.visibleToClient ?? false)
    : true;

  const comment = await tx.comment.create({
    data: { subjectType, subjectId, authorId: actor.id, body, visibleToClient },
  });

  await writeAudit(tx, {
    actorId: actor.id,
    action: "comment.created",
    subjectType,
    subjectId,
    payload: {
      commentId: comment.id,
      visibleToClient: comment.visibleToClient,
    },
  });

  if (input.notifyUserId) {
    await emitNotification(tx, {
      recipients: { userIds: [input.notifyUserId] },
      kind: "COMMENTED",
      subjectType,
      subjectId,
      summary: `New comment on ${subjectType.toLowerCase()} ${subjectId}`,
    });
  }

  return comment;
}

export async function listComments(
  actor: Actor,
  subjectType: string,
  subjectId: string,
  client: PrismaClient = prisma,
): Promise<SerializedComment[]> {
  if (!isInternal(actor) && subjectType === "Change") {
    throw new NotFoundError("not found");
  }

  const rows = await client.comment.findMany({
    where: {
      subjectType,
      subjectId,
      ...(isInternal(actor) ? {} : { visibleToClient: true }),
    },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { kind: true, displayName: true } } },
  });

  return rows.map((row) => serializeComment(actor, row));
}
