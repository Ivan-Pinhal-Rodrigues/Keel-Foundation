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

/**
 * `GET /api/demands` query string. `view` is read by the register page only
 * (`register` list vs. `?view=board`, Task 7) — the list service ignores it.
 */
export const listDemandsQuery = z.object({
  status: z.enum(DEMAND_STATUSES).optional(),
  source: z.enum(DEMAND_SOURCES).optional(),
  mine: z.coerce.boolean().optional(),
  view: z.enum(["register", "board"]).optional(),
});
export type ListDemandsQuery = z.infer<typeof listDemandsQuery>;

/** `PATCH /api/demands/:id/value` body (field names follow the schema — ruling 2). */
export const scoreValueBody = z.object({
  businessValue: z.string().trim().min(1).max(2000),
  valueScore: z.number().int().min(1).max(10).optional(),
});
export type ScoreValueBody = z.infer<typeof scoreValueBody>;

/** `PATCH /api/demands/:id/effort` body. */
export const scoreEffortBody = z.object({
  effort: z.enum(["S", "M", "L"]),
  feasibility: z.string().trim().max(2000).optional(),
});
export type ScoreEffortBody = z.infer<typeof scoreEffortBody>;

/** `PATCH /api/demands/:id/cost-of-delay` body. */
export const costOfDelayBody = z.object({
  costOfDelay: z.string().trim().min(1).max(2000),
});
export type CostOfDelayBody = z.infer<typeof costOfDelayBody>;

/**
 * `POST /api/demands/:id/decision` body (ruling 2 / ruling 4). `PURSUE` / `PARK`
 * approve, `DROP` rejects. `overrideJustification` — a string of at least 20
 * trimmed characters — is the single-approver escape hatch when the decider is
 * the submitter.
 */
export const decisionBody = z.object({
  decision: z.enum(["PURSUE", "PARK", "DROP"]),
  note: z.string().trim().max(2000).optional(),
  overrideJustification: z.string().trim().min(20).max(2000).optional(),
});
export type DecisionBody = z.infer<typeof decisionBody>;

/** `POST /api/demands/:id/reject` body. */
export const rejectBody = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export type RejectBody = z.infer<typeof rejectBody>;
