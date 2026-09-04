import { expect, test } from "vitest";
import {
  AUDIT_ACTION_LABELS,
  auditActionLabel,
  guestAuditActionLabel,
} from "@/server/audit/labels";

// The actions Phase 0 already writes (grep `action:` in src/server) — every one must have a label.
const PHASE0_ACTIONS = [
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "session.revoked",
  "guest_invite.created",
  "guest_invite.redeemed",
  "comment.created",
];

test("every Phase 0 audit action has an explicit label", () => {
  for (const a of PHASE0_ACTIONS)
    expect(AUDIT_ACTION_LABELS[a], a).toBeTruthy();
});

test("auditActionLabel humanises an unknown action", () => {
  expect(auditActionLabel("demand.value_scored")).toBe("Demand value scored");
});

test("guestAuditActionLabel hides internal-only actions", () => {
  expect(guestAuditActionLabel("comment.created")).toBeTruthy();
  expect(guestAuditActionLabel("session.revoked")).toBeNull();
});
