import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthenticatedError } from "@/server/auth/actor";
import {
  ForbiddenError,
  GoneError,
  NotFoundError,
  SegregationError,
} from "@/server/policy/errors";
import { logger } from "@/server/log";

/**
 * The single place a thrown error becomes an HTTP response. `withRequest` wraps
 * every handler in a try/catch that funnels here, so routes can `throw` and
 * stay thin.
 *
 * The policy-layer errors are wired here as of Task 16 — `ForbiddenError` →
 * 403, `NotFoundError` → 404, `GoneError` → 410, `SegregationError` → 409
 * (carrying its `overrideAction`). Task 18 only needs to confirm this wiring,
 * not add it. Branches run most-specific first, above the generic 500.
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
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (e instanceof NotFoundError) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (e instanceof GoneError) {
    return NextResponse.json({ error: "gone" }, { status: 410 });
  }
  if (e instanceof SegregationError) {
    return NextResponse.json(
      { error: "segregation", overrideAction: e.overrideAction },
      { status: 409 },
    );
  }
  logger.error({ err: e }, "unhandled error in request handler");
  return NextResponse.json({ error: "internal" }, { status: 500 });
}
