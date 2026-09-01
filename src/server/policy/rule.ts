import type { Actor } from "@/server/policy/actor";
import type { Subject } from "@/server/policy/subjects/types";

/**
 * A single authorisation rule. Returns on allow; throws on deny —
 * `ForbiddenError` (403), `NotFoundError` (404, a guest's cross-client miss),
 * or `SegregationError` (409, carrying the `overrideAction`). Pure: no I/O, no
 * database — the route has already loaded whatever of the `Subject` it passes.
 */
export type Rule = (actor: Actor, subject: Subject) => void;
