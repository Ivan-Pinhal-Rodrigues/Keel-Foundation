import { z } from "zod";

/**
 * Request contracts for the guest-invite endpoints.
 * `plans/DESIGN.md` §8 — every endpoint has its Zod schema here and the typed
 * client infers from it.
 */

/** `POST /api/guest-invites` body (Task 16). */
export const createInviteBody = z.object({
  clientId: z.string().min(1),
  email: z.email(),
});
export type CreateInviteBody = z.infer<typeof createInviteBody>;
