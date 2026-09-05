import { z } from "zod";

/**
 * Request contracts for the demand endpoints (`plans/plan-01-demand.md`).
 * The enum arrays are duplicated from `prisma/schema.prisma` — acceptable per
 * the plan; a shared `$Enums` value tuple is a nice-to-have, not required.
 */

const DEMAND_SOURCES = [
  "CLIENT",
  "INCIDENT",
  "TECH_DEBT",
  "COMPLIANCE",
  "OPPORTUNITY",
  "INTERNAL",
] as const;

const DEMAND_STATUSES = [
  "SUBMITTED",
  "TRIAGING",
  "WORTH_ASSESSED",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
] as const;

/** `POST /api/demands` body. */
export const createDemandBody = z.object({
  title: z.string().trim().min(1).max(200),
  problem: z.string().trim().min(1).max(5000),
  source: z.enum(DEMAND_SOURCES),
  affectedService: z.string().trim().max(200).optional(),
});
export type CreateDemandBody = z.infer<typeof createDemandBody>;

/** `GET /api/demands` query string. */
export const listDemandsQuery = z.object({
  status: z.enum(DEMAND_STATUSES).optional(),
  source: z.enum(DEMAND_SOURCES).optional(),
  mine: z.coerce.boolean().optional(),
});
export type ListDemandsQuery = z.infer<typeof listDemandsQuery>;
