import { expect, test } from "vitest";
import {
  INCIDENT_TRANSITIONS,
  REOPEN_WINDOW_MS,
  assertTransition,
} from "@/server/modules/incident/state";
import { ForbiddenError } from "@/server/policy/errors";

test("legal transitions per spec section 4", () => {
  expect(() => assertTransition("NEW", "ASSIGNED")).not.toThrow();
  expect(() => assertTransition("ASSIGNED", "IN_PROGRESS")).not.toThrow();
  expect(() => assertTransition("IN_PROGRESS", "RESOLVED")).not.toThrow();
  expect(() => assertTransition("RESOLVED", "CLOSED")).not.toThrow();
  expect(() => assertTransition("RESOLVED", "IN_PROGRESS")).not.toThrow();
  expect(() => assertTransition("CLOSED", "IN_PROGRESS")).not.toThrow();
});

test("illegal transitions throw ForbiddenError", () => {
  expect(() => assertTransition("NEW", "IN_PROGRESS")).toThrow(ForbiddenError);
  expect(() => assertTransition("NEW", "RESOLVED")).toThrow(ForbiddenError);
  expect(() => assertTransition("IN_PROGRESS", "CLOSED")).toThrow(
    ForbiddenError,
  );
  expect(() => assertTransition("CLOSED", "CLOSED")).toThrow(ForbiddenError);
  expect(() => assertTransition("ASSIGNED", "NEW")).toThrow(ForbiddenError);
});

test("the reopen window is 14 days", () => {
  expect(REOPEN_WINDOW_MS).toBe(14 * 24 * 60 * 60 * 1000);
  // every status is a key (compile-time Record guarantees it; assert at runtime too)
  expect(Object.keys(INCIDENT_TRANSITIONS).sort()).toEqual(
    ["ASSIGNED", "CLOSED", "IN_PROGRESS", "NEW", "RESOLVED"].sort(),
  );
});
