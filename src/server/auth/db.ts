import type { PrismaTransaction } from "@/server/db/tx";
import { prisma } from "@/server/db/client";

/**
 * The database handle the auth module reads and writes through — and the one
 * seam that makes the auth surface testable.
 *
 * `session.ts` and the login route resolve their client via `authDb()` instead
 * of closing over the `@/server/db/client` singleton. That matters because the
 * singleton is bound to the `public` schema, while the integration harness
 * (`src/test/db.ts`) hands every test file its own disposable `test_*` schema.
 * Without the indirection a route test would have to seed and clean up
 * `public`; with it, a test calls `useAuthDb(db())` in `beforeAll` and
 * `useAuthDb(null)` in `afterAll`, and nothing ever touches `public`.
 *
 * `AuthDb` is `Prisma.TransactionClient` (re-exported from `src/server/db/tx.ts`
 * — the `@prisma/client` import is confined to `src/server/db/**` by the eslint
 * boundary). A full `PrismaClient` is assignable to it, so both the app
 * singleton and a harness client fit, and so does a `$transaction` client if a
 * later task needs to create a session inside one.
 */
export type AuthDb = PrismaTransaction;

let override: AuthDb | null = null;

/** The client the auth module uses right now: the app singleton unless a test
 *  has pointed it elsewhere. */
export const authDb = (): AuthDb => override ?? prisma;

/** Tests only. Point the auth module at `client`; pass `null` to restore the
 *  app singleton. Never call this from application code. */
export function useAuthDb(client: AuthDb | null): void {
  override = client;
}
