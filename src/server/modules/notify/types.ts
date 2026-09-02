import type { $Enums } from "@prisma/client";

/**
 * The `emitNotification` contract (spec 05 §3, spec 00 §7).
 *
 * Frozen so Phase 1 module owners can wire notification calls against it without
 * coordinating on recipient-resolution logic. Type-only `@prisma/client` import
 * — erased at compile, so the `src/server/**` Prisma value boundary is untouched.
 */

export type NotificationKind = $Enums.NotificationKind;

/**
 * Who a notification is for. `{ hat }` and `{ audience: "ALL_INTERNAL" }` resolve
 * to active internal users only; `{ userIds }` is taken as given (unknown ids are
 * silently skipped rather than crashing on a missing FK).
 */
export type Recipients =
  { userIds: string[] } | { hat: $Enums.Hat } | { audience: "ALL_INTERNAL" };

export type NotificationSpec = {
  recipients: Recipients;
  kind: NotificationKind;
  subjectType: string;
  subjectId: string;
  summary: string;
  /** The acting user, dropped from the resolved recipient list (you are not
   *  notified of your own action). */
  excludeActorId?: string;
  /** When set, one `EmailOutbox` row per recipient that has an address. */
  email?: { template: string; payload: Record<string, unknown> };
};
