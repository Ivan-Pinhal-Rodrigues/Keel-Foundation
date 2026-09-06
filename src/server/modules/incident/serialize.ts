import type { $Enums } from "@prisma/client";
import { type Actor } from "@/server/policy/actor";
import { serializePick } from "@/server/policy/serialize";
import { isOverdue } from "./priority";

/**
 * Role-aware view of one incident row (spec §3).
 *
 * `INCIDENT_GUEST_KEYS` is an ALLOWLIST: a guest sees only these keys plus the
 * `guestTransform` output. A column added to the row later stays hidden from a
 * guest until it is deliberately added here — it cannot leak by omission. An
 * internal reader gets the whole row unchanged, except `overdue` is freshly
 * derived from the SLA and status.
 */

export const INCIDENT_GUEST_KEYS = [
  "id",
  "ref",
  "title",
  "description",
  "affectedService",
  "createdAt",
] as const;

/**
 * Internal status label (plain form for UI).
 */
export function internalIncidentStatusLabel(s: $Enums.IncidentStatus): string {
  switch (s) {
    case "NEW":
      return "New";
    case "ASSIGNED":
      return "Assigned";
    case "IN_PROGRESS":
      return "In progress";
    case "RESOLVED":
      return "Resolved";
    case "CLOSED":
      return "Closed";
  }
}

/**
 * Guest-facing status label (spec §6). NEW and ASSIGNED both read as "Reported".
 */
export function guestIncidentStatusLabel(s: $Enums.IncidentStatus): string {
  switch (s) {
    case "NEW":
    case "ASSIGNED":
      return "Reported";
    case "IN_PROGRESS":
      return "Investigating";
    case "RESOLVED":
      return "Resolved";
    case "CLOSED":
      return "Closed";
  }
}

/**
 * Convert milliseconds to a human-readable duration string.
 */
function humanizeDuration(ms: number): string {
  const totalSeconds = Math.abs(Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return days === 1 ? "1 day" : `${days} days`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/**
 * Guest SLA line: resolved/closed → "Resolved in X"; open & past due → "Response overdue";
 * open & before due → "Response due in X".
 */
export function guestSlaLine(
  row: {
    dueAt: Date;
    status: $Enums.IncidentStatus;
    createdAt: Date;
    resolvedAt: Date | null;
  },
  now: Date,
): string {
  const terminal = row.status === "RESOLVED" || row.status === "CLOSED";

  if (terminal && row.resolvedAt) {
    const ms = row.resolvedAt.getTime() - row.createdAt.getTime();
    return `Resolved in ${humanizeDuration(ms)}`;
  }

  // A terminal incident with no `resolvedAt` (e.g. closed straight from a
  // migration) must not fall through to the due/overdue comparison below and
  // print "Response overdue" on something already done.
  if (terminal) {
    return "Resolved";
  }

  const dueMs = row.dueAt.getTime();
  const nowMs = now.getTime();

  if (nowMs > dueMs) {
    return "Response overdue";
  }

  const remainingMs = dueMs - nowMs;
  return `Response due in ${humanizeDuration(remainingMs)}`;
}

/**
 * Find the fix line from linked changes: look for a FIXES link; none → null;
 * status CLOSED → "fixed"; else → "on_the_way".
 */
function fixLineFrom(
  linkedChanges: { kind: $Enums.LinkKind; status: $Enums.ChangeStatus }[],
): "on_the_way" | "fixed" | null {
  const fixesLink = linkedChanges.find((link) => link.kind === "FIXES");
  if (!fixesLink) return null;
  return fixesLink.status === "CLOSED" ? "fixed" : "on_the_way";
}

/** `Incident` + `assignee?: {displayName} | null` + `client?: {name} | null`. */
type IncidentWithRelations = Record<string, unknown>;

export function serializeIncident(
  actor: Actor,
  row: IncidentWithRelations,
  ctx: {
    now: Date;
    linkedChanges: { kind: $Enums.LinkKind; status: $Enums.ChangeStatus }[];
  },
): Record<string, unknown> {
  const out = serializePick(actor, row, {
    guestKeys: INCIDENT_GUEST_KEYS,
    guestTransform: (r) => ({
      status: guestIncidentStatusLabel(r.status as $Enums.IncidentStatus),
      slaLine: guestSlaLine(
        {
          dueAt: r.dueAt as Date,
          status: r.status as $Enums.IncidentStatus,
          createdAt: r.createdAt as Date,
          resolvedAt: (r.resolvedAt as Date | null) ?? null,
        },
        ctx.now,
      ),
      fix: fixLineFrom(ctx.linkedChanges),
      resolvedAt: (r.resolvedAt as Date | null) ?? null,
    }),
  });

  // For internal actors, override the stale stored `overdue` with a fresh derivation
  if (actor.kind === "INTERNAL") {
    return {
      ...out,
      overdue: isOverdue(
        {
          dueAt: row.dueAt as Date,
          status: row.status as $Enums.IncidentStatus,
        },
        ctx.now,
      ),
    };
  }

  return out;
}
