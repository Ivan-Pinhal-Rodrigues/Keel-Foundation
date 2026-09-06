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
/**
 * `POST /api/changes/:id/advance` — advance the change one stage. `from` is the
 * status the caller last saw (a stale value is a 409); `acknowledgements` carries
 * the free-checkbox gate values (`standaloneConfirmed`, `wentToPlanAcknowledged`).
 */
export const advanceChangeBody = z.object({
  from: z.enum(CHANGE_STATUSES),
  acknowledgements: z.record(z.string(), z.boolean()).optional(),
});
export type AdvanceChangeBody = z.infer<typeof advanceChangeBody>;

/** `POST /api/changes/:id/schedule` — set/adjust the change window. */
export const scheduleChangeBody = z
  .object({
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
  })
  .transform((b) => ({
    windowStart: new Date(b.windowStart),
    windowEnd: new Date(b.windowEnd),
  }));
export type ScheduleChangeBody = z.infer<typeof scheduleChangeBody>;

/** `POST /api/changes/:id/rollback` — roll an implementing change back. */
export const rollbackChangeBody = z.object({
  note: z.string().trim().min(1).max(5000),
});
export type RollbackChangeBody = z.infer<typeof rollbackChangeBody>;

/** `POST /api/changes/:id/pir` — record the post-implementation review. */
export const pirBody = z.object({
  valueRealized: z.enum(["YES", "PARTIAL", "NO"]),
  lessons: z.string().trim().min(1).max(10000),
});
export type PirBody = z.infer<typeof pirBody>;

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
