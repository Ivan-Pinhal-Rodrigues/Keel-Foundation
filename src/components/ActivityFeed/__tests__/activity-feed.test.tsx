/** @vitest-environment jsdom */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ActivityFeed } from "@/components/ActivityFeed";
import styles from "@/components/ActivityFeed/ActivityFeed.module.css";

afterEach(cleanup);

const ITEMS = [
  {
    id: "a1",
    text: "INC-0034 moved to Monitoring",
    meta: "11:34 · today",
    tone: "var(--warn)",
  },
  { id: "a2", text: "CHG-0053 raised from the support inbox", meta: "today" },
];

test("renders one row per item with its text and meta", () => {
  const { container } = render(<ActivityFeed items={ITEMS} />);
  expect(container.querySelectorAll("li")).toHaveLength(2);
  expect(screen.getByText("INC-0034 moved to Monitoring")).toBeTruthy();
  expect(screen.getByText("11:34 · today")).toBeTruthy();
  expect(
    screen.getByText("CHG-0053 raised from the support inbox"),
  ).toBeTruthy();
  expect(screen.getByText("today")).toBeTruthy();
});

test("colours the dot from item.tone, falling back to --border-strong", () => {
  const { container } = render(<ActivityFeed items={ITEMS} />);
  const dots = [...container.querySelectorAll(`.${styles.fdot}`)];
  expect(dots).toHaveLength(2);
  expect(dots[0]?.getAttribute("style")).toContain("var(--warn)");
  expect(dots[1]?.getAttribute("style")).toContain("var(--border-strong)");
});
