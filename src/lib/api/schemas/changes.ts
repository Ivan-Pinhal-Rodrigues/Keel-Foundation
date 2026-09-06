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
 * `PATCH /api/changes/:id` — edit the RFC / risk / impact / rollback fields.
 * Every field is optional but at least one must be present.
 */
export const editChangeBody = z
  .object({
    rfc: z.string().trim().min(1).max(20000).optional(),
    riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
    impactAssessment: z.string().trim().min(1).max(10000).optional(),
    rollbackPlan: z.string().trim().min(1).max(10000).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "at least one field is required",
  });
export type EditChangeBody = z.infer<typeof editChangeBody>;

/** `POST /api/changes/:id/link-incident` — link an incident to the change. */
export const linkIncidentBody = z.object({
  incidentId: z.string().trim().min(1),
  kind: z.enum(["CAUSED_BY", "FIXES"]),
});
export type LinkIncidentBody = z.infer<typeof linkIncidentBody>;

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
