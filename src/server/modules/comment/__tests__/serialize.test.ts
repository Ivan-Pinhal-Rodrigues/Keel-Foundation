import { expect, test } from "vitest";
import type { $Enums, Comment } from "@prisma/client";
import { serializeComment } from "@/server/modules/comment/serialize";
import type { Actor } from "@/server/policy/actor";

/**
 * Pure unit test for the role-aware comment serializer — no DB. `listComments`
 * exercises the same masking end to end; this pins the exact output shape and
 * the `createdAt` (`Date`) → ISO-8601 `string` conversion in isolation, so a
 * regression to returning the raw `Date`, or leaking an internal-only key to a
 * guest, fails here first.
 */

const INTERNAL: Actor = {
  id: "u-int",
  kind: "INTERNAL",
  hats: [],
  clientId: null,
};
const GUEST: Actor = { id: "u-guest", kind: "GUEST", hats: [], clientId: "c1" };

const CREATED_AT = new Date("2026-02-03T04:05:06.789Z");

type Author = { kind: $Enums.UserKind; displayName: string };

function row(
  author: Author,
  over: Partial<Comment> = {},
): Comment & {
  author: Author;
} {
  return {
    id: "cmt-1",
    subjectType: "Demand",
    subjectId: "DEM-0001",
    authorId: "author-1",
    body: "hello there",
    visibleToClient: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...over,
    author,
  };
}

test("internal reader, internal-authored row → full shape with ISO createdAt", () => {
  const out = serializeComment(
    INTERNAL,
    row({ kind: "INTERNAL", displayName: "Alice Internal" }),
  );
  expect(out).toEqual({
    id: "cmt-1",
    body: "hello there",
    visibleToClient: false,
    authorId: "author-1",
    authorName: "Alice Internal",
    createdAt: CREATED_AT.toISOString(),
  });
  expect(typeof out.createdAt).toBe("string");
});

test("internal reader, guest-authored row → full shape with the guest's real identity", () => {
  const out = serializeComment(
    INTERNAL,
    row(
      { kind: "GUEST", displayName: "Gary Guest" },
      { authorId: "guest-7", visibleToClient: true },
    ),
  );
  expect(out).toEqual({
    id: "cmt-1",
    body: "hello there",
    visibleToClient: true,
    authorId: "guest-7",
    authorName: "Gary Guest",
    createdAt: CREATED_AT.toISOString(),
  });
  expect(typeof out.createdAt).toBe("string");
});

test("guest reader, internal-authored row → 'Keel team', internal keys stripped", () => {
  const out = serializeComment(
    GUEST,
    row({ kind: "INTERNAL", displayName: "Alice Internal" }),
  );
  expect(out).toEqual({
    id: "cmt-1",
    body: "hello there",
    author: "Keel team",
    createdAt: CREATED_AT.toISOString(),
  });
  expect(out).not.toHaveProperty("authorId");
  expect(out).not.toHaveProperty("authorName");
  expect(out).not.toHaveProperty("visibleToClient");
  expect(typeof out.createdAt).toBe("string");
});

test("guest reader, guest-authored row → the guest's display name, internal keys stripped", () => {
  const out = serializeComment(
    GUEST,
    row({ kind: "GUEST", displayName: "Gary Guest" }, { authorId: "guest-7" }),
  );
  expect(out).toEqual({
    id: "cmt-1",
    body: "hello there",
    author: "Gary Guest",
    createdAt: CREATED_AT.toISOString(),
  });
  expect(out).not.toHaveProperty("authorId");
  expect(out).not.toHaveProperty("authorName");
  expect(out).not.toHaveProperty("visibleToClient");
  expect(typeof out.createdAt).toBe("string");
});
