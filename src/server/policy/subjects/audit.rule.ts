/**
 * `audit.*` — the audit log is internal-only
 * (`plans/specs/00-foundation.md` §4.2). The `{ type: "audit" }` subject
 * carries nothing; these are pure role checks.
 *
 *   audit.view    INTERNAL
 *   audit.export  INTERNAL
 */
import type { Rule } from "@/server/policy/rule";
import { requireInternal } from "@/server/policy/subjects/helpers";

export const auditRules = {
  "audit.view": (actor) => requireInternal(actor),
  "audit.export": (actor) => requireInternal(actor),
} satisfies Record<string, Rule>;
