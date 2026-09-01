/**
 * The Actor — who is making a request — and the hat set.
 *
 * FROZEN interface contract: `plans/specs/00-foundation.md` §8 and
 * `plans/DESIGN.md` §8. Every policy function, serializer, and route in Phase 1
 * takes an `Actor`; the shape does not change without a note to all Phase 1
 * owners. This file is types plus two total predicates — no I/O, no imports, so
 * it is safe to pull in from anywhere (including `@/server/context`).
 */

export type Hat =
  "DEVELOPER" | "REVIEWER" | "BUSINESS_APPROVER" | "TECHNICAL_APPROVER";

export type Actor = {
  id: string;
  kind: "INTERNAL" | "GUEST";
  hats: Hat[]; // [] for guests
  clientId: string | null; // non-null iff kind === "GUEST"
};

export const isInternal = (a: Actor) => a.kind === "INTERNAL";
export const hasHat = (a: Actor, h: Hat) => a.hats.includes(h);
