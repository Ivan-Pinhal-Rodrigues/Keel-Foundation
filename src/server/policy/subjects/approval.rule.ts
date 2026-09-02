/**
 * The `change.approve.*` CAB gates — `plans/specs/00-foundation.md` §4.2 and
 * `plans/DESIGN.md` §3.4 (segregation of duties).
 *
 *   change.approve.technical   TECHNICAL_APPROVER, not the change owner
 *                              (SoD → overrideAction "change.approve.technical.override")
 *   change.approve.business    BUSINESS_APPROVER, not the change owner, and only
 *                              when riskLevel = HIGH
 *                              (SoD → overrideAction "change.approve.business.override")
 *
 * Kept apart from the rest of `change.*` because these are the approval steps:
 * hat-routed, risk-gated (business), and owner-blocked with an override signal.
 */
import { ForbiddenError } from "@/server/policy/errors";
import type { Rule } from "@/server/policy/rule";
import {
  asChange,
  requireHat,
  requireNotSubmitter,
  requireSubjectId,
} from "@/server/policy/subjects/helpers";

export const approvalRules = {
  "change.approve.technical": (actor, subject) => {
    // Fail closed: without a change carrying its owner id the SoD check is a
    // no-op, so deny rather than approve unverifiably.
    const change = asChange(subject);
    if (!change) throw new ForbiddenError("change subject required");
    requireSubjectId(change.ownerId, "ownerId");
    requireHat(actor, "TECHNICAL_APPROVER");
    requireNotSubmitter(
      actor,
      change.ownerId,
      "change.approve.technical.override",
    );
  },
  "change.approve.business": (actor, subject) => {
    requireHat(actor, "BUSINESS_APPROVER");
    const change = asChange(subject);
    if (!change || change.riskLevel !== "HIGH") {
      throw new ForbiddenError(
        "business approval applies only to a HIGH-risk change",
      );
    }
    // Fail closed on the SoD check just like the technical gate.
    requireSubjectId(change.ownerId, "ownerId");
    requireNotSubmitter(
      actor,
      change.ownerId,
      "change.approve.business.override",
    );
  },
} satisfies Record<string, Rule>;
