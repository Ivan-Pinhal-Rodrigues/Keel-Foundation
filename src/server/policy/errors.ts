/**
 * The policy-layer domain errors.
 *
 * `mapError` (`src/lib/api/errors.ts`) is the one place these become HTTP
 * responses: `ForbiddenError` → 403, `NotFoundError` → 404, `GoneError` → 410,
 * `SegregationError` → 409 (carrying its `overrideAction`). They are thrown by
 * module services and `authorize` (Task 18+), never constructed in a route
 * handler.
 *
 * `plans/specs/00-foundation.md` §4.1. Kept import-free — like
 * `policy/actor.ts`, this is a leaf so anything may depend on it.
 * `UnauthenticatedError` deliberately lives elsewhere (`@/server/auth/actor`):
 * `withRequest` needs it and that module has no other policy dependency.
 */

/** The actor is known but not allowed to perform this action. → 403. */
export class ForbiddenError extends Error {}

/** The subject does not exist — or the actor may not be told that it does
 *  (guest "not yours" reads collapse to this). → 404. */
export class NotFoundError extends Error {}

/** The subject was valid once but is spent: an expired, already-redeemed, or
 *  unknown invite. → 410. */
export class GoneError extends Error {}

/** Separation of duties: the actor holds the right hat but may not apply it to
 *  this subject (approving a change they own, deciding a demand they raised).
 *  `overrideAction` is the machine-readable action the route offers instead.
 *  → 409. */
export class SegregationError extends Error {
  constructor(public overrideAction: string) {
    super("segregation of duties");
  }
}
