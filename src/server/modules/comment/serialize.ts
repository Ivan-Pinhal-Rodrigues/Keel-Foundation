import type { $Enums, Comment } from "@prisma/client";
import { isInternal } from "@/server/policy/actor";
import type { Actor } from "@/server/policy/actor";

/**
 * Role-aware view of one `Comment` row (spec 00 §8).
 *
 * An internal reader sees everything: the author's real id and name, and the
 * `visibleToClient` flag they toggle. A guest sees neither an internal user's
 * identity (replaced by "Keel team") nor the flag nor any author id — only
 * guest display names, which for a guest are their own and their same-client
 * peers'. `listComments` has already filtered the rows a guest may see.
 */

type CommentWithAuthor = Comment & {
  author: { kind: $Enums.UserKind; displayName: string };
};

export type SerializedComment =
  | {
      id: string;
      body: string;
      visibleToClient: boolean;
      authorId: string;
      authorName: string;
      createdAt: string;
    }
  | { id: string; body: string; author: string; createdAt: string };

export function serializeComment(
  actor: Actor,
  row: CommentWithAuthor,
): SerializedComment {
  if (isInternal(actor)) {
    return {
      id: row.id,
      body: row.body,
      visibleToClient: row.visibleToClient,
      authorId: row.authorId,
      authorName: row.author.displayName,
      createdAt: row.createdAt.toISOString(),
    };
  }

  const author =
    row.author.kind === "INTERNAL" ? "Keel team" : row.author.displayName;
  return {
    id: row.id,
    body: row.body,
    author,
    createdAt: row.createdAt.toISOString(),
  };
}
