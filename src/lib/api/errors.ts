import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthenticatedError } from "@/server/auth/actor";
import { logger } from "@/server/log";

/**
 * The single place a thrown error becomes an HTTP response. `withRequest` wraps
 * every handler in a try/catch that funnels here, so routes can `throw` and
 * stay thin.
 *
 * Task 18 extends this with the policy-layer errors — `ForbiddenError` → 403,
 * `NotFoundError` → 404, `SegregationError` → 409 (carrying its
 * `overrideAction`). Add those branches above the generic fallthrough, most
 * specific first.
 */
export function mapError(e: unknown): Response {
  if (e instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: "invalid", issues: e.issues },
      { status: 400 },
    );
  }
  logger.error({ err: e }, "unhandled error in request handler");
  return NextResponse.json({ error: "internal" }, { status: 500 });
}
