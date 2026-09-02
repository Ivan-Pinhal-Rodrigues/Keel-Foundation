import { expect, test } from "vitest";
import { ACTIONS } from "@/server/policy/actions";
import type { Actor } from "@/server/policy/actor";
import { authorize, RULES } from "@/server/policy/authorize";
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

test("every wired rule key is a catalogue Action", () => {
  // `satisfies Record<string, Rule>` on each rule module checks values, not
  // keys; `Record<Action, Rule>` on RULES catches a missing action but not a
  // typo'd / stray one. This does.
  const known = new Set<string>(ACTIONS);
  const stray = Object.keys(RULES).filter((k) => !known.has(k));
  expect(stray).toEqual([]);
});
