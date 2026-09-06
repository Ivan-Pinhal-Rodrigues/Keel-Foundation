import { z } from "zod";

/**
 * Request contract for `GET /api/users` — the incident drawer's assignee picker
 * (`plans/plan-02-incident.md` Task 9). Only `kind=INTERNAL` is supported today;
 * the enum keeps the door open for more without a breaking change.
 */
export const listUsersQuery = z.object({
  kind: z.enum(["INTERNAL"]).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuery>;
