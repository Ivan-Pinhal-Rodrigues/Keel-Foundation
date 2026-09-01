import { expect, test } from "vitest";
import type { Actor } from "@/server/policy/actor";
import { authorize } from "@/server/policy/authorize";
import { ForbiddenError } from "@/server/policy/errors";

const guest: Actor = { id: "g", kind: "GUEST", hats: [], clientId: "c1" };

test("an unknown action is denied", () => {
  expect(() =>
    // @ts-expect-error deliberately invalid action
    authorize(guest, "nonsense.action", { type: "none" }),
  ).toThrow(ForbiddenError);
});

test("a guest may create a demand", () => {
  expect(() =>
    authorize(guest, "demand.create", { type: "demand" }),
  ).not.toThrow();
});

test("a guest may not view a change", () => {
  expect(() => authorize(guest, "change.view", { type: "change" })).toThrow(
    ForbiddenError,
  );
});
