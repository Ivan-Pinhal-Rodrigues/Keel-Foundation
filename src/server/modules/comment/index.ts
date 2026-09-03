import type { Comment, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/server/audit/write";
import { prisma } from "@/server/db/client";
import type { PrismaTransaction } from "@/server/db/tx";
import { emitNotification } from "@/server/modules/notify/emit";
import { isInternal } from "@/server/policy/actor";
import type { Actor } from "@/server/policy/actor";
import { NotFoundError } from "@/server/policy/errors";
import { requireOwnClientOr404 } from "@/server/policy/subjects/helpers";
import { serializeComment, type SerializedComment } from "./serialize";

/**
 * The shared comment module (spec 00 §8) — used by the demand, incident, and
 * change drawers and by the guest portal.
 *
 * `subject.type` is stored capitalized ("Demand" | "Incident" | "Change") in
 * `Comment.subjectType`. The caller still runs the *action* check —
 * `authorize(actor, "comment.create", subject)` for a write, the subject's own
 * view check for a read — but ownership is enforced here too: the subject
 * carries its `clientId` and both entry points call `requireOwnClientOr404`, so
 * a portal route that forgets the ownership check cannot leak another client's
 * `visibleToClient` thread. A `Change` subject stays internal-only — a guest
 * gets a `NotFoundError` and never learns one exists.
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

export type CommentSubject =
  | { type: "Demand"; id: string; clientId: string | null }
  | { type: "Incident"; id: string; clientId: string | null }
  | { type: "Change"; id: string };

/**
 * Create a comment on `subject`, audit it, and optionally notify one user.
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
    subject: CommentSubject;
    body: string;
    /** Internal author's choice; default false. Ignored for guests — a guest
     *  author's comment is always forced visibleToClient = true. */
    visibleToClient?: boolean;
    notifyUserId?: string;
  },
): Promise<Comment> {
  const { actor, subject, body } = input;

  // NOTE: the policy layer currently returns 403 (ForbiddenError) for
  // `comment.create` on a guest-invisible subject; Phase 1 route wiring should
  // prefer this module's 404 so a guest never learns a Change exists.
  if (subject.type === "Change") {
    if (!isInternal(actor)) throw new NotFoundError("not found");
  } else {
    requireOwnClientOr404(actor, subject.clientId);
  }

  const visibleToClient = isInternal(actor)
    ? (input.visibleToClient ?? false)
    : true;

  const comment = await tx.comment.create({
    data: {
      subjectType: subject.type,
      subjectId: subject.id,
      authorId: actor.id,
      body,
      visibleToClient,
    },
  });

  await writeAudit(tx, {
    actorId: actor.id,
    action: "comment.created",
    subjectType: subject.type,
    subjectId: subject.id,
    payload: {
      commentId: comment.id,
      visibleToClient: comment.visibleToClient,
    },
  });

  if (input.notifyUserId) {
    await emitNotification(tx, {
      recipients: { userIds: [input.notifyUserId] },
      kind: "COMMENTED",
      subjectType: subject.type,
      subjectId: subject.id,
      summary: `New comment on ${subject.type.toLowerCase()} ${subject.id}`,
    });
  }

  return comment;
}

export async function listComments(
  actor: Actor,
  subject: CommentSubject,
  client: PrismaClient = prisma,
): Promise<SerializedComment[]> {
  // Same reachability gate as `addComment`: a guest may not learn a Change
  // exists, and may only read a Demand / Incident on their own client.
  if (subject.type === "Change") {
    if (!isInternal(actor)) throw new NotFoundError("not found");
  } else {
    requireOwnClientOr404(actor, subject.clientId);
  }

  const rows = await client.comment.findMany({
    where: {
      subjectType: subject.type,
      subjectId: subject.id,
      ...(isInternal(actor) ? {} : { visibleToClient: true }),
    },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { kind: true, displayName: true } } },
  });

  return rows.map((row) => serializeComment(actor, row));
}
