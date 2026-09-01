import type { AuthDb } from "./db";
import { authDb } from "./db";
import { verifyPassword } from "./password";

export type Credentials = { email: string; password: string };

/**
 * Email + password → the user id, or `null`.
 *
 * The one place a password is checked. It creates no session and sets no
 * cookie — that is the login route's job (`specs/00-foundation.md` §3.3), which
 * keeps this a pure function of (client, credentials) and directly testable
 * against the disposable-schema harness.
 *
 * Every failure returns the same `null`: wrong password, deactivated user and
 * unknown email are indistinguishable to the caller, so the 401 it produces
 * never tells an attacker which of the three happened.
 */
export async function verifyCredentials(
  client: AuthDb,
  input: Credentials,
): Promise<{ id: string } | null> {
  const user = await client.user.findUnique({ where: { email: input.email } });
  if (!user || !user.isActive) return null;
  if (!(await verifyPassword(user.passwordHash, input.password))) return null;
  return { id: user.id };
}

/** `verifyCredentials` bound to the app's client — what route handlers call.
 *  (Routes live under `src/app/**` and must not import the Prisma singleton.) */
export const authenticate = (input: Credentials) =>
  verifyCredentials(authDb(), input);
