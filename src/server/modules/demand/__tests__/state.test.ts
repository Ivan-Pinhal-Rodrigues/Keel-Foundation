import { expect, test } from "vitest";
import {
  DEMAND_TRANSITIONS,
  assertTransition,
  worthComplete,
} from "@/server/modules/demand/state";
import { ForbiddenError } from "@/server/policy/errors";

test("legal and illegal transitions", () => {
  expect(() => assertTransition("SUBMITTED", "TRIAGING")).not.toThrow();
  expect(() => assertTransition("TRIAGING", "WORTH_ASSESSED")).not.toThrow();
  expect(() => assertTransition("WORTH_ASSESSED", "APPROVED")).not.toThrow();
  expect(() => assertTransition("WORTH_ASSESSED", "REJECTED")).not.toThrow();
  expect(() => assertTransition("SUBMITTED", "APPROVED")).toThrow(
    ForbiddenError,
  );
  expect(() => assertTransition("CONVERTED", "TRIAGING")).toThrow(
    ForbiddenError,
  );
  expect(() => assertTransition("REJECTED", "TRIAGING")).toThrow(
    ForbiddenError,
  );
});

test("every status has a transition list (the table is total over DemandStatus)", () => {
  for (const from of Object.keys(
    DEMAND_TRANSITIONS,
  ) as (keyof typeof DEMAND_TRANSITIONS)[]) {
    expect(Array.isArray(DEMAND_TRANSITIONS[from])).toBe(true);
  }
});

test("worthComplete needs value narrative, effort, and cost of delay", () => {
  expect(
    worthComplete({ businessValue: "v", effort: "M", costOfDelay: "c" }),
  ).toBe(true);
  expect(
    worthComplete({ businessValue: "v", effort: null, costOfDelay: "c" }),
  ).toBe(false);
  expect(
    worthComplete({ businessValue: null, effort: "M", costOfDelay: "c" }),
  ).toBe(false);
  expect(
    worthComplete({ businessValue: "v", effort: "M", costOfDelay: null }),
  ).toBe(false);
});
