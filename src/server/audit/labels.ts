/** Every audit action string a module writes → a short human phrase for a
 *  Timeline / ActivityFeed. Modules add their entries here. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login": "Logged in",
  "auth.login_failed": "Login failed",
  "auth.logout": "Logged out",
  "session.revoked": "Session revoked",
  "guest_invite.created": "Guest invite created",
  "guest_invite.redeemed": "Guest invite redeemed",
  "comment.created": "Comment added",
  "approval.request_opened": "Approval requested",
  "approval.step_approved": "Approval step approved",
  "approval.step_rejected": "Approval step rejected",
  "approval.request_resolved": "Approval resolved",
  "approval.request_cancelled": "Approval cancelled",
  "approval.override": "Single-approver override",
  "demand.create": "Demand raised",
  "demand.triage_started": "Triage started",
  "demand.value_scored": "Business value scored",
  "demand.effort_scored": "Effort scored",
  "demand.cost_of_delay_set": "Cost of delay set",
  "demand.decided": "Decision recorded",
  "demand.decide.override": "Single-approver override",
  "demand.rejected": "Declined",
  "demand.converted": "Converted to a change",
  "incident.create": "Incident reported",
  "incident.categorized": "Categorised",
  "incident.assigned": "Assigned",
  "incident.transitioned": "Status changed",
  "incident.resolved": "Resolved",
  "incident.closed": "Closed",
  "incident.reopened": "Reopened",
  "incident.overdue": "Marked overdue",
};

/** The phrase, or a humanised fallback (`"demand.value_scored" → "Demand value scored"`). */
export function auditActionLabel(action: string): string {
  return (
    AUDIT_ACTION_LABELS[action] ??
    action
      .replace(/\./g, " ")
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

/** For a guest-facing feed: the subset + guest phrasing (internal-only actions → null). */
export function guestAuditActionLabel(action: string): string | null {
  // Only guest-visible actions
  const GUEST_VISIBLE: Record<string, string> = {
    "comment.created": "Comment added",
    "demand.create": "Demand raised",
    "demand.decided": "Decision recorded",
    "demand.rejected": "Declined",
    // A guest should see that their request has been picked up for delivery,
    // in words that do not assume they know what a "change" is.
    "demand.converted": "Work started",
    // demand.decide.override stays internal-only — a guest never sees that the
    // decision needed a single-approver override.
    "incident.create": "Problem reported",
    "incident.transitioned": "Status updated",
    "incident.resolved": "Marked resolved",
    "incident.closed": "Closed",
  };

  return GUEST_VISIBLE[action] ?? null;
}
