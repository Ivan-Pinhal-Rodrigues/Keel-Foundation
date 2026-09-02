/** @vitest-environment jsdom */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Gallery } from "@/app/dev/components/Gallery";
import { stubMatchMedia, stubRadixEnv } from "@/test/dom";

stubMatchMedia(false);
stubRadixEnv();
afterEach(cleanup);

/** Every component that must have its own labelled section in the gallery. */
const SECTIONS = [
  "AppShell",
  "Drawer",
  "Toasts",
  "Tile",
  "Panel",
  "Pill",
  "PriorityTag",
  "RiskLabel",
  "DataTable",
  "LifecyclePips",
  "ActivityFeed",
  "Timeline",
  "LifecycleStepper",
] as const;

test("the gallery renders without throwing", () => {
  expect(() => render(<Gallery />)).not.toThrow();
});

test.each(SECTIONS)("has a labelled <h2> section for %s", (name) => {
  render(<Gallery />);
  expect(
    screen.getByRole("heading", { name: new RegExp(`^${name}$`, "i") }),
  ).toBeTruthy();
});
