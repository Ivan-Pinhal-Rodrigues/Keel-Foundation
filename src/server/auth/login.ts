import { writeAudit } from "@/server/audit/write";
import { runInTransaction } from "@/server/db/tx";
import { prisma } from "@/server/db/client";
import type { Credentials } from "./credentials";
import { verifyCredentials } from "./credentials";
import { createSession } from "./session";

/**
 * The login use case: verify, create the session, emit the audit event.
 *
 * It lives here rather than in the route handler for two reasons. The session
 * row and its `auth.login` event have to commit or roll back together — an
 * audited login that left no session, or a session nobody can account for, are
 * both wrong — and that invariant belongs to the module, not to HTTP. And route
 * handlers under `src/app/**` may not import the Prisma client at all (eslint
 * `no-restricted-imports`); they go through a module service, which is this.
 *
 * `specs/00-foundation.md` §3.4 requires `auth.login` and `auth.login_failed`.
 * Both are written here, so every path through the login endpoint that reaches
 * a credential check leaves exactly one audit row. Callers must already be
 * inside `runWithContext` — `writeAudit` stamps `requestId` from it.
 */

export type LoginResult =
  { ok: true; token: string; expires: Date } | { ok: false };

export async function login(
  input: Credentials,
  meta?: { userAgent?: string; ip?: string },
): Promise<LoginResult> {
  const user = await verifyCredentials(prisma, input);

  if (!user) {
    // §3.4: "actor = the attempted email, not a user id" — there is no user to
    // point at, so the email is the subject and `actorId` stays null.
    await runInTransaction((tx) =>
      writeAudit(tx, {
        actorId: null,
        action: "auth.login_failed",
        subjectType: "auth",
        subjectId: input.email,
        payload: { email: input.email, reason: "invalid_credentials" },
      }),
    );
    return { ok: false };
  }

  const session = await runInTransaction(async (tx) => {
    const created = await createSession(user.id, meta, tx);
    await writeAudit(tx, {
      actorId: user.id,
      action: "auth.login",
      subjectType: "User",
      subjectId: user.id,
    });
    return created;
  });

  return { ok: true, ...session };
}
