import { z } from "zod";

/**
 * Request contract for the record-decision endpoint (spec 04 §4, §5).
 *
 * `reason` is required and non-empty; the service re-trims it. `overrideJustification`
 * — at least 20 trimmed characters — is the single-approver escape hatch, sent only
 * when the decider is the request's creator and separation of duties would
 * otherwise block the decision.
 */
export const recordDecisionBody = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().min(1).max(2000),
  overrideJustification: z.string().trim().min(20).max(2000).optional(),
});
export type RecordDecisionBody = z.infer<typeof recordDecisionBody>;
