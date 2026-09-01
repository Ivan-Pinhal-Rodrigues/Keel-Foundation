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

/**
 * `POST /api/guest-invites/:token/redeem` body (Task 17). The invitee's email
 * comes from the invite, not the request; `confirm` is a client-only check.
 * Server is authoritative (`specs/07-guest-portal.md` §4.4).
 */
export const redeemInviteBody = z.object({
  name: z.string().trim().min(1),
  password: z.string().min(8),
});
export type RedeemInviteBody = z.infer<typeof redeemInviteBody>;
