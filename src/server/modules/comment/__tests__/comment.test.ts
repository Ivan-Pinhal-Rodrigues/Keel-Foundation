import { randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import { withTestDb } from "@/test/db";
import { runWithContext } from "@/server/context";
import { addComment, listComments } from "@/server/modules/comment";
import type { Actor } from "@/server/policy/actor";
import { NotFoundError } from "@/server/policy/errors";

const db = withTestDb();

/**
 * One per-file schema, shared across every test here, so each test scopes its
 * reads by a unique `subjectId`.
 *
 * `addComment` writes an `AuditEvent`, so its calls run inside `runWithContext`
 * (the notify tests skip this because `emitNotification` writes no audit). The
 * transaction is opened on `db()` itself, never `runInTransaction` — that binds
 * to the app `prisma` singleton (`?schema=public`), invisible to this file's
 * disposable schema.
 */

const uniq = () => randomBytes(6).toString("hex");

const withCtx = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithContext({ requestId: `req-${uniq()}` }, fn);

/** A real INTERNAL `User` row plus an `Actor` whose id is that user's id
 *  (the `Comment.authorId` FK and the notify recipient both need real rows). */
async function mkInternal() {
  const user = await db().user.create({
    data: {
      email: `i-${uniq()}@k`,
      passwordHash: "x",
      displayName: `Keeler ${uniq()}`,
      kind: "INTERNAL",
      hats: [],
    },
  });
  const actor: Actor = {
    id: user.id,
    kind: "INTERNAL",
    hats: [],
    clientId: null,
  };
  return { user, actor };
}

/** A `Client`, a GUEST `User` scoped to it, and a matching guest `Actor`. Pass
 *  an existing `clientId` to put another guest on the same client. */
async function mkGuest(clientId?: string) {
  const cid =
    clientId ??
    (
      await db().client.create({
        data: { name: `C-${uniq()}`, isActive: true },
      })
    ).id;
  const user = await db().user.create({
    data: {
      email: `g-${uniq()}@k`,
      passwordHash: "x",
      displayName: `Guest ${uniq()}`,
      kind: "GUEST",
      hats: [],
      clientId: cid,
    },
  });
  const actor: Actor = { id: user.id, kind: "GUEST", hats: [], clientId: cid };
  return { user, actor, clientId: cid };
}

test("a GUEST author's comment is forced visibleToClient=true even when false is passed", async () => {
  const { actor } = await mkGuest();
  const subjectId = `dem-${uniq()}`;

  const c = await withCtx(() =>
    db().$transaction((tx) =>
      addComment(tx, {
        actor,
        subjectType: "Demand",
        subjectId,
        body: "please look",
        visibleToClient: false,
      }),
    ),
  );

  expect(c.visibleToClient).toBe(true);
  const row = await db().comment.findUniqueOrThrow({ where: { id: c.id } });
  expect(row.visibleToClient).toBe(true);
});

test("an internal author's comment defaults to visibleToClient=false, honours true", async () => {
  const { actor } = await mkInternal();
  const subjectId = `inc-${uniq()}`;

  const def = await withCtx(() =>
    db().$transaction((tx) =>
      addComment(tx, {
        actor,
        subjectType: "Incident",
        subjectId,
        body: "internal note",
      }),
    ),
  );
  expect(def.visibleToClient).toBe(false);

  const shared = await withCtx(() =>
    db().$transaction((tx) =>
      addComment(tx, {
        actor,
        subjectType: "Incident",
        subjectId,
        body: "for the client",
        visibleToClient: true,
      }),
    ),
  );
  expect(shared.visibleToClient).toBe(true);
});

test("listComments for a guest returns only visibleToClient rows", async () => {
  const { actor: internal } = await mkInternal();
  const { actor: guest } = await mkGuest();
  const subjectId = `dem-${uniq()}`;

  await withCtx(() =>
    db().$transaction(async (tx) => {
      await addComment(tx, {
        actor: internal,
        subjectType: "Demand",
        subjectId,
        body: "visible",
        visibleToClient: true,
      });
      await addComment(tx, {
        actor: internal,
        subjectType: "Demand",
        subjectId,
        body: "hidden",
        visibleToClient: false,
      });
    }),
  );

  const seen = await listComments(guest, "Demand", subjectId, db());
  expect(seen).toHaveLength(1);
  expect(seen[0]!.body).toBe("visible");
});

test("guest listComments masks internal authors, shows same-client guest names, strips internal keys", async () => {
  const { actor: internalAuthor } = await mkInternal();
  const { actor: guestReader, clientId } = await mkGuest();
  const { actor: guestAuthor, user: guestAuthorUser } = await mkGuest(clientId);
  const subjectId = `inc-${uniq()}`;

  await withCtx(() =>
    db().$transaction(async (tx) => {
      await addComment(tx, {
        actor: internalAuthor,
        subjectType: "Incident",
        subjectId,
        body: "from keel",
        visibleToClient: true,
      });
      await addComment(tx, {
        actor: guestAuthor,
        subjectType: "Incident",
        subjectId,
        body: "from a guest",
      });
    }),
  );

  const rows = await listComments(guestReader, "Incident", subjectId, db());
  const byBody = Object.fromEntries(
    rows.map((r) => [r.body, r as { author?: string }]),
  );

  expect(byBody["from keel"]!.author).toBe("Keel team");
  expect(byBody["from a guest"]!.author).toBe(guestAuthorUser.displayName);

  for (const r of rows) {
    expect(r).not.toHaveProperty("authorId");
    expect(r).not.toHaveProperty("authorName");
    expect(r).not.toHaveProperty("visibleToClient");
  }
});

test("listComments for an internal reader returns every row with real author identity", async () => {
  const { actor: reader } = await mkInternal();
  const { actor: author, user: authorUser } = await mkInternal();
  const subjectId = `chg-${uniq()}`;

  await withCtx(() =>
    db().$transaction(async (tx) => {
      await addComment(tx, {
        actor: author,
        subjectType: "Change",
        subjectId,
        body: "hidden note",
      });
      await addComment(tx, {
        actor: author,
        subjectType: "Change",
        subjectId,
        body: "shared note",
        visibleToClient: true,
      });
    }),
  );

  const rows = await listComments(reader, "Change", subjectId, db());
  expect(rows).toHaveLength(2);
  for (const r of rows) {
    const row = r as {
      authorId: string;
      authorName: string;
      visibleToClient: boolean;
    };
    expect(row.authorId).toBe(authorUser.id);
    expect(row.authorName).toBe(authorUser.displayName);
    expect(typeof row.visibleToClient).toBe("boolean");
  }
});

test("listComments rejects a guest reading a Change with NotFoundError", async () => {
  const { actor: guest } = await mkGuest();
  await expect(
    listComments(guest, "Change", `chg-${uniq()}`, db()),
  ).rejects.toBeInstanceOf(NotFoundError);
});

test("addComment rejects a guest commenting on a Change with NotFoundError", async () => {
  const { actor: guest } = await mkGuest();
  await expect(
    withCtx(() =>
      db().$transaction((tx) =>
        addComment(tx, {
          actor: guest,
          subjectType: "Change",
          subjectId: `chg-${uniq()}`,
          body: "hi",
        }),
      ),
    ),
  ).rejects.toBeInstanceOf(NotFoundError);
});

test("addComment writes a comment.created audit event carrying the comment id", async () => {
  const { actor } = await mkInternal();
  const subjectId = `dem-${uniq()}`;

  const c = await withCtx(() =>
    db().$transaction((tx) =>
      addComment(tx, {
        actor,
        subjectType: "Demand",
        subjectId,
        body: "note",
        visibleToClient: true,
      }),
    ),
  );

  const ev = await db().auditEvent.findFirstOrThrow({
    where: { action: "comment.created", subjectId },
  });
  expect(ev.subjectType).toBe("Demand");
  expect(ev.actorId).toBe(actor.id);
  expect(ev.payload).toMatchObject({ commentId: c.id, visibleToClient: true });
});

test("addComment emits one COMMENTED notification for notifyUserId, none without it", async () => {
  const { actor } = await mkInternal();
  const { user: recipient } = await mkInternal();

  const withNotify = `inc-${uniq()}`;
  await withCtx(() =>
    db().$transaction((tx) =>
      addComment(tx, {
        actor,
        subjectType: "Incident",
        subjectId: withNotify,
        body: "ping",
        notifyUserId: recipient.id,
      }),
    ),
  );
  const notes = await db().notification.findMany({
    where: { subjectId: withNotify },
  });
  expect(notes).toHaveLength(1);
  expect(notes[0]!.userId).toBe(recipient.id);
  expect(notes[0]!.kind).toBe("COMMENTED");

  const noNotify = `inc-${uniq()}`;
  await withCtx(() =>
    db().$transaction((tx) =>
      addComment(tx, {
        actor,
        subjectType: "Incident",
        subjectId: noNotify,
        body: "quiet",
      }),
    ),
  );
  expect(
    await db().notification.count({ where: { subjectId: noNotify } }),
  ).toBe(0);
});

test("a rollback of the surrounding transaction persists no comment, audit, or notification", async () => {
  const { actor } = await mkInternal();
  const { user: recipient } = await mkInternal();
  const subjectId = `dem-${uniq()}`;

  await expect(
    withCtx(() =>
      db().$transaction(async (tx) => {
        await addComment(tx, {
          actor,
          subjectType: "Demand",
          subjectId,
          body: "doomed",
          visibleToClient: true,
          notifyUserId: recipient.id,
        });
        throw new Error("boom");
      }),
    ),
  ).rejects.toThrow(/boom/);

  expect(await db().comment.count({ where: { subjectId } })).toBe(0);
  expect(
    await db().auditEvent.count({
      where: { subjectId, action: "comment.created" },
    }),
  ).toBe(0);
  expect(await db().notification.count({ where: { subjectId } })).toBe(0);
});
