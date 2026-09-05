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
  expect(auditActionLabel("demand.some_unregistered_action")).toBe(
    "Demand some unregistered action",
  );
});

test("the Task 3 demand actions carry an explicit label", () => {
  for (const a of [
    "demand.create",
    "demand.triage_started",
    "demand.value_scored",
    "demand.effort_scored",
    "demand.cost_of_delay_set",
  ])
    expect(AUDIT_ACTION_LABELS[a], a).toBeTruthy();
});

test("guestAuditActionLabel hides internal-only actions", () => {
  expect(guestAuditActionLabel("comment.created")).toBeTruthy();
  expect(guestAuditActionLabel("demand.create")).toBeTruthy();
  expect(guestAuditActionLabel("session.revoked")).toBeNull();
  expect(guestAuditActionLabel("demand.triage_started")).toBeNull();
});
