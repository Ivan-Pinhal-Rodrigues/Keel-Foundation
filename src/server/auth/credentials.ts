import type { PrismaTransaction } from "@/server/db/tx";
import { verifyPassword } from "./password";

export type Credentials = { email: string; password: string };

/**
 * A real argon2id hash, of a random string nobody holds, with the same
 * parameters as `password.ts`.
 *
 * It exists to be verified against and thrown away. Without it the miss paths
 * (unknown email, deactivated user) would skip argon2 entirely and answer in
 * ~1ms while a wrong password takes ~15-130ms, so response latency would say
 * whether an address has an account even though the status code does not.
 * Verifying this constant instead makes every failure cost the same.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$0YAvyNP/CX1DDIHB3xKayQ$99XI4ko4JfK+AOhZKVmf2bkg/QdRRkUidAYI6q/H/Qo";

/**
 * Email + password → the user id, or `null`.
 *
 * The one place a password is checked. It creates no session and sets no
 * cookie — that is `login.ts`'s job — which keeps this a pure function of
 * (client, credentials) and directly testable against the disposable-schema
 * harness.
 *
 * Every failure returns the same `null` after the same work: wrong password,
 * deactivated user and unknown email are indistinguishable to the caller by
 * both response and timing, so the 401 it produces never tells an attacker
 * which of the three happened.
 */
export async function verifyCredentials(
  client: PrismaTransaction,
  input: Credentials,
): Promise<{ id: string } | null> {
  const user = await client.user.findUnique({ where: { email: input.email } });

  if (!user || !user.isActive) {
    // Burn the same CPU as the real path, then fail. Result deliberately unused.
    await verifyPassword(DUMMY_HASH, input.password);
    return null;
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) return null;
  return { id: user.id };
}
