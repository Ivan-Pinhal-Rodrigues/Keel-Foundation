import { z } from "zod";

/**
 * Request contracts for the incident endpoints (`plans/plan-02-incident.md`).
 * The enum arrays are duplicated from `prisma/schema.prisma` — acceptable per
 * the plan. Some of these schemas (`categorizeIncidentBody`, `assignIncidentBody`,
 * `transitionIncidentBody`, `reopenIncidentBody`, `incidentCommentBody`) are
 * consumed by later tasks (5-7); they live here so those tasks only import.
 */

const LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
const STATUSES = [
  "NEW",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
] as const;
const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;

/** `POST /api/incidents` — internal reporter. */
export const createIncidentInternalBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  affectedService: z.string().trim().min(1).max(200),
  impact: z.enum(LEVELS),
  urgency: z.enum(LEVELS),
});
export type CreateIncidentInternalBody = z.infer<
  typeof createIncidentInternalBody
>;

/** `POST /api/incidents` — guest reporter (spec §5). No impact/urgency. */
export const reportIncidentGuestBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  affectedService: z.string().trim().min(1).max(200),
  affectingLevel: z.string().trim().min(1).max(2000),
});
export type ReportIncidentGuestBody = z.infer<typeof reportIncidentGuestBody>;

export const listIncidentsQuery = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  // True-only semantics: `?overdue=true` filters, `?overdue=false` and an
  // omitted param both mean "not filtered". (`z.coerce.boolean()` would treat
  // any non-empty string, `"false"` included, as `true`.)
  overdue: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuery>;

export const categorizeIncidentBody = z.object({
  impact: z.enum(LEVELS),
  urgency: z.enum(LEVELS),
  reason: z.string().trim().min(1).max(2000).optional(),
});
export type CategorizeIncidentBody = z.infer<typeof categorizeIncidentBody>;

export const assignIncidentBody = z.object({
  assigneeId: z.string().trim().min(1),
});
export type AssignIncidentBody = z.infer<typeof assignIncidentBody>;

/** `POST /api/incidents/:id/transition`. `to` ∈ the forward set only —
 *  IN_PROGRESS / RESOLVED / CLOSED; reopen has its own endpoint. */
export const transitionIncidentBody = z.object({
  to: z.enum(["IN_PROGRESS", "RESOLVED", "CLOSED"]),
  resolution: z.string().trim().min(1).max(5000).optional(),
});
export type TransitionIncidentBody = z.infer<typeof transitionIncidentBody>;

export const reopenIncidentBody = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export type ReopenIncidentBody = z.infer<typeof reopenIncidentBody>;

/** Shared comment body — identical shape to demands (`commentBody`). */
export const incidentCommentBody = z.object({
  body: z.string().trim().min(1).max(5000),
  visibleToClient: z.boolean().optional(),
});
export type IncidentCommentBody = z.infer<typeof incidentCommentBody>;
