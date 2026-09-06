import { z } from "zod";

/**
 * Request contracts for the change endpoints (`plans/plan-03-change-approvals`).
 * The enum arrays are duplicated from `prisma/schema.prisma` — acceptable per
 * the plan.
 */

const CHANGE_STATUSES = [
  "DRAFT",
  "ASSESSING",
  "APPROVAL",
  "SCHEDULED",
  "IMPLEMENTING",
  "PIR",
  "CLOSED",
  "ROLLED_BACK",
] as const;

/** `POST /api/changes` — create a change. v1 accepts only NORMAL / EMERGENCY. */
export const createChangeBody = z.object({
  title: z.string().trim().min(1).max(200),
  rfc: z.string().trim().min(1).max(20000),
  changeType: z.enum(["NORMAL", "EMERGENCY"]).optional(),
  originatingDemandId: z.string().trim().min(1).optional(),
});
export type CreateChangeBody = z.infer<typeof createChangeBody>;

/**
 * `GET /api/changes` — list filters. True-only semantics for the booleans:
 * `?mine=true` filters, `?mine=false` and an omitted param both mean "not
 * filtered". (`z.coerce.boolean()` would treat any non-empty string, `"false"`
 * included, as `true` — plan-02's fix wave established this form.)
 */
export const listChangesQuery = z.object({
  status: z.enum(CHANGE_STATUSES).optional(),
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  scheduled: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type ListChangesQuery = z.infer<typeof listChangesQuery>;
