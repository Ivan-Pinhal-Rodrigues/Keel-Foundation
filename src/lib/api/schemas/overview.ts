import { z } from "zod";

/**
 * Response contract for `GET /api/overview` — the internal dashboard payload
 * (`plan-04` Task 6). It mirrors `OverviewPayload` in
 * `@/server/modules/overview/service` exactly. This is the **wire** shape:
 * `NextResponse.json()` has already turned `Date` columns into ISO strings, so
 * timestamps are `z.iso.datetime()`.
 */

const queueItem = z.object({
  id: z.string(),
  kind: z.enum(["incident", "change", "demand"]),
  ref: z.string(),
  title: z.string(),
  hint: z.string(),
  href: z.string(),
  overdue: z.boolean(),
  sortKey: z.number(),
});

const approvalItem = z.object({
  subjectType: z.string(),
  subjectId: z.string(),
  subjectRef: z.string(),
  subjectTitle: z.string(),
  currentRequiredHat: z.string(),
  needsOverride: z.boolean(),
  href: z.string(),
});

const activityItem = z.object({
  at: z.iso.datetime(),
  label: z.string(),
  text: z.string(),
});

const funnelStage = z.object({
  stage: z.string(),
  label: z.string(),
  count: z.number(),
});

const scheduledWindow = z.object({
  id: z.string(),
  ref: z.string(),
  title: z.string(),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
});

const emailFailures = z.object({
  count: z.number(),
  recent: z.array(
    z.object({
      toEmail: z.string(),
      template: z.string(),
      lastError: z.string().nullable(),
      attempts: z.number(),
    }),
  ),
});

export const overviewResponse = z.object({
  tiles: z.object({
    myOpenItems: z.number(),
    approvalsWaiting: z.number(),
    overdue: z.number(),
    demandsInTriage: z.number(),
  }),
  myQueue: z.array(queueItem),
  approvals: z.array(approvalItem),
  activity: z.array(activityItem),
  funnel: z.array(funnelStage),
  windows: z.array(scheduledWindow),
  emailFailures,
});
export type OverviewResponse = z.infer<typeof overviewResponse>;
