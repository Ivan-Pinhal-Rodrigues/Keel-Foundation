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
  };

  return GUEST_VISIBLE[action] ?? null;
}
