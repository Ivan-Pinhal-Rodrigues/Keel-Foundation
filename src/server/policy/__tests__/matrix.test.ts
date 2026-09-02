import { describe, expect, it } from "vitest";
import { ACTIONS } from "@/server/policy/actions";
import { authorize } from "@/server/policy/authorize";
import {
  ForbiddenError,
  NotFoundError,
  SegregationError,
} from "@/server/policy/errors";
import { CASES } from "./matrix.cases";

describe("authorize — exhaustive allow/deny matrix (specs/00-foundation.md §4.3)", () => {
  it.each(CASES)(
    "$action — $label ($expected)",
    ({ actor, action, subject, expected }) => {
      if (expected === "allow") {
        expect(() => authorize(actor, action, subject)).not.toThrow();
        return;
      }
      if (expected === "deny") {
        expect(() => authorize(actor, action, subject)).toThrow(ForbiddenError);
        return;
      }
      if (expected === "notfound") {
        expect(() => authorize(actor, action, subject)).toThrow(NotFoundError);
        return;
      }

      // `segregation:<overrideAction>`
      const overrideAction = expected.slice("segregation:".length);
      let thrown: unknown;
      try {
        authorize(actor, action, subject);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SegregationError);
      expect((thrown as SegregationError).overrideAction).toBe(overrideAction);
    },
  );

  it("has at least one case for every action in the catalogue", () => {
    const covered = new Set(CASES.map((c) => c.action));
    const missing = ACTIONS.filter((a) => !covered.has(a));
    expect(missing).toEqual([]);
  });
});
