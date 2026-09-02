/** @vitest-environment jsdom */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Timeline } from "@/components/Timeline";

afterEach(cleanup);

const ITEMS = [
  { time: "09:12", text: "Raised from the support inbox" },
  { time: "10:40", text: "Worth call: Pursue" },
  { time: "14:20", text: <b>Canary passed the 25% gate</b> },
];

test("renders one row per item with its time and text", () => {
  const { container } = render(<Timeline items={ITEMS} />);
  expect(container.querySelectorAll("li")).toHaveLength(3);
  expect(screen.getByText("09:12")).toBeTruthy();
  expect(screen.getByText("Raised from the support inbox")).toBeTruthy();
  expect(screen.getByText("14:20")).toBeTruthy();
  expect(screen.getByText("Canary passed the 25% gate")).toBeTruthy();
});

test("renders nothing but the list when items is empty", () => {
  const { container } = render(<Timeline items={[]} />);
  expect(container.querySelectorAll("li")).toHaveLength(0);
  expect(container.querySelector("ul")).not.toBeNull();
});
