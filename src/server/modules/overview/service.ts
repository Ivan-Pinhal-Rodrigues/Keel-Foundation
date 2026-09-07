import { recentEvents } from "@/server/audit/read";
import { listApprovalsForActor } from "@/server/modules/approval/service";
import {
  listChanges,
  listScheduledWindows,
} from "@/server/modules/change/service";
import {
  countDemandsByStatus,
  listDemands,
} from "@/server/modules/demand/service";
import {
  listIncidents,
  listOverdueIncidents,
} from "@/server/modules/incident/service";
import { listFailedEmails } from "@/server/modules/notify/read";
import { type Actor, hasHat } from "@/server/policy/actor";
import { requireInternal } from "@/server/policy/subjects/helpers";

/**
 * The internal dashboard payload (`plan-04` Task 6, spec 06 §5).
 *
 * `buildOverview` composes MODULE READS ONLY — it holds no database client of
 * its own and never touches a table directly (the one `EmailOutbox` read it
 * needs lives in `notify/read.ts::listFailedEmails`). Per spec 06 §5 this file
 * stays free of any direct DB-layer import and any raw-SQL escape hatch; the
 * client type below is borrowed structurally from a module read's signature.
 * Every consumed read defaults its own `client` to the app singleton when
 * `buildOverview` is called without one.
 */

/** The DB client type a consumed module read accepts, taken from a read's own
 *  signature so this file needs no DB-layer import (spec 06 §5). */
type OverviewClient = NonNullable<Parameters<typeof recentEvents>[1]>;

export type OverviewPayload = {
  tiles: {
    myOpenItems: number;
    approvalsWaiting: number;
    overdue: number;
    demandsInTriage: number;
  };
  myQueue: {
    id: string;
    kind: "incident" | "change" | "demand";
    ref: string;
    title: string;
    hint: string;
    href: string;
    overdue: boolean;
    sortKey: number;
  }[];
  approvals: {
    subjectType: string;
    subjectId: string;
    subjectRef: string;
    subjectTitle: string;
    currentRequiredHat: string;
    needsOverride: boolean;
    href: string;
  }[];
  activity: { at: string; label: string; text: string }[];
  funnel: { stage: string; label: string; count: number }[];
  windows: {
    id: string;
    ref: string;
    title: string;
    windowStart: string;
    windowEnd: string;
  }[];
  emailFailures: {
    count: number;
    recent: {
      toEmail: string;
      template: string;
      lastError: string | null;
      attempts: number;
    }[];
  };
};

/** How many recent audit events feed the activity strip. */
const ACTIVITY_LIMIT = 20;

const asDate = (v: unknown): Date =>
  v instanceof Date ? v : new Date(v as string);

/** The SLA hint for an open incident that is not yet overdue. */
function dueHint(dueAt: Date): string {
  const ms = dueAt.getTime() - Date.now();
  if (ms <= 0) return "Response due now";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "Response due within the hour";
  if (hours < 48) return `Response due in ${hours}h`;
  return `Response due in ${Math.round(hours / 24)}d`;
}

/**
 * Assemble the dashboard overview. `requireInternal` first — a guest gets a flat
 * `ForbiddenError` (→ 403) before any read runs.
 */
export async function buildOverview(
  actor: Actor,
  client?: OverviewClient,
): Promise<OverviewPayload> {
  requireInternal(actor);

  const [
    myIncidentsRaw,
    myChangesRaw,
    triagingDemands,
    approvedDemands,
    approvalsRaw,
    overdueIncidents,
    counts,
    windows,
    events,
    emailFailures,
  ] = await Promise.all([
    listIncidents(actor, { mine: true }, client),
    listChanges(actor, { mine: true }, client),
    listDemands(actor, { status: "TRIAGING" }, client),
    listDemands(actor, { status: "APPROVED" }, client),
    listApprovalsForActor(actor, client),
    listOverdueIncidents(client),
    countDemandsByStatus(client),
    listScheduledWindows(client),
    recentEvents(ACTIVITY_LIMIT, client),
    listFailedEmails(client),
  ]);

  // --- my queue -----------------------------------------------------------
  const myIncidents = myIncidentsRaw.filter((r) => {
    const s = r.status as string;
    return s !== "RESOLVED" && s !== "CLOSED";
  });
  const myChanges = myChangesRaw.filter((r) => {
    const s = r.status as string;
    return s !== "CLOSED" && s !== "ROLLED_BACK";
  });

  const incidentQueue = myIncidents.map((r) => {
    const overdue = r.overdue === true;
    const dueAt = asDate(r.dueAt);
    return {
      id: r.id as string,
      kind: "incident" as const,
      ref: r.ref as string,
      title: r.title as string,
      hint: overdue ? "SLA overdue" : dueHint(dueAt),
      href: `/incidents?open=${r.id as string}`,
      overdue,
      sortKey: overdue ? 0 : dueAt.getTime(),
    };
  });

  const changeQueue = myChanges.map((r) => {
    const ws = r.windowStart as Date | string | null;
    return {
      id: r.id as string,
      kind: "change" as const,
      ref: r.ref as string,
      title: r.title as string,
      hint: "You own this change",
      href: `/changes?open=${r.id as string}`,
      overdue: false,
      sortKey: ws ? asDate(ws).getTime() : Number.MAX_SAFE_INTEGER,
    };
  });

  const isBiz = hasHat(actor, "BUSINESS_APPROVER");
  const isTech = hasHat(actor, "TECHNICAL_APPROVER");
  const demandQueue = triagingDemands.flatMap((r) => {
    const worth = r.worth as {
      valueScore: number | null;
      effort: string | null;
    } | null;
    const needsValue = isBiz && worth?.valueScore == null;
    const needsEffort = isTech && worth?.effort == null;
    if (!needsValue && !needsEffort) return [];
    return [
      {
        id: r.id as string,
        kind: "demand" as const,
        ref: r.ref as string,
        title: r.title as string,
        hint: needsValue
          ? "Needs your value score"
          : "Needs your effort estimate",
        href: `/demands?open=${r.id as string}`,
        overdue: false,
        sortKey: asDate(r.createdAt).getTime(),
      },
    ];
  });

  const myQueue = [...incidentQueue, ...changeQueue, ...demandQueue].sort(
    (a, b) => a.sortKey - b.sortKey,
  );

  // --- approvals --------------------------------------------------------
  const approvals = approvalsRaw.map((a) => ({
    subjectType: a.subjectType,
    subjectId: a.subjectId,
    subjectRef: a.subjectRef,
    subjectTitle: a.subjectTitle,
    currentRequiredHat: a.currentRequiredHat as string,
    needsOverride: a.needsOverride,
    href: "/approvals",
  }));

  // --- activity --------------------------------------------------------
  const activity = events.map((e) => ({
    at: e.at,
    label: e.label,
    text: `${e.label} — ${e.subjectType} ${e.subjectId}`,
  }));

  // --- funnel (submitted → converted; REJECTED excluded) ---------------
  const approvedPursue = approvedDemands.filter(
    (r) => (r.worth as { decision?: string } | null)?.decision === "PURSUE",
  ).length;
  const funnel = [
    { stage: "submitted", label: "Submitted", count: counts.SUBMITTED },
    { stage: "triaging", label: "Triaging", count: counts.TRIAGING },
    {
      stage: "worth_assessed",
      label: "Worth assessed",
      count: counts.WORTH_ASSESSED,
    },
    { stage: "approved", label: "Approved (pursue)", count: approvedPursue },
    { stage: "converted", label: "Converted", count: counts.CONVERTED },
  ];

  return {
    tiles: {
      myOpenItems: myIncidents.length + myChanges.length,
      approvalsWaiting: approvals.length,
      overdue: overdueIncidents.length,
      demandsInTriage: counts.TRIAGING + counts.WORTH_ASSESSED,
    },
    myQueue,
    approvals,
    activity,
    funnel,
    windows,
    emailFailures,
  };
}
