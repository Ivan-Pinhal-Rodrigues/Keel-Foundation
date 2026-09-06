import { expect, test } from "vitest";
import { z } from "zod";
import { mapError } from "@/lib/api/errors";
import {
  ForbiddenError,
  NotFoundError,
  GoneError,
  SegregationError,
  ConflictError,
} from "@/server/policy/errors";
import { UnauthenticatedError } from "@/server/auth/actor";

async function body(r: Response) {
  return r.json();
}

test("UnauthenticatedError → 401", async () => {
  const r = mapError(new UnauthenticatedError("x"));
  expect(r.status).toBe(401);
  expect(await body(r)).toEqual({ error: "unauthenticated" });
});

test("ZodError → 400 with issues", async () => {
  const err = z.object({ a: z.string() }).safeParse({}).error!;
  const r = mapError(err);
  expect(r.status).toBe(400);
  const b = await body(r);
  expect(b.error).toBe("invalid");
  expect(Array.isArray(b.issues)).toBe(true);
});

test("ForbiddenError → 403", async () => {
  expect(mapError(new ForbiddenError("x")).status).toBe(403);
});
test("NotFoundError → 404 { error: not_found }", async () => {
  const r = mapError(new NotFoundError("x"));
  expect(r.status).toBe(404);
  expect(await body(r)).toEqual({ error: "not_found" });
});
test("GoneError → 410", async () => {
  expect(mapError(new GoneError("x")).status).toBe(410);
});
test("SegregationError → 409 with overrideAction", async () => {
  const r = mapError(new SegregationError("demand.decide.override"));
  expect(r.status).toBe(409);
  expect(await body(r)).toEqual({
    error: "segregation",
    overrideAction: "demand.decide.override",
  });
});
test("ConflictError → 409 { error: conflict }", async () => {
  const r = mapError(new ConflictError("x"));
  expect(r.status).toBe(409);
  expect(await body(r)).toEqual({ error: "conflict" });
});
test("an unknown error → 500 { error: internal }", async () => {
  const r = mapError(new Error("boom"));
  expect(r.status).toBe(500);
  expect(await body(r)).toEqual({ error: "internal" });
});
