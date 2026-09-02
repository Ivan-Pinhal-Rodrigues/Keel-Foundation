/** @vitest-environment jsdom */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Panel } from "@/components/Panel";
import styles from "@/components/Panel/Panel.module.css";

afterEach(cleanup);

test("renders the title in a heading, the count, and the children", () => {
  render(
    <Panel title="Review queue" count="6 open">
      <p>queue body</p>
    </Panel>,
  );
  expect(screen.getByRole("heading", { name: "Review queue" })).toBeTruthy();
  expect(screen.getByText("6 open")).toBeTruthy();
  expect(screen.getByText("queue body")).toBeTruthy();
});

test("omits the count element when no count is given", () => {
  const { container } = render(
    <Panel title="Activity">
      <p>feed</p>
    </Panel>,
  );
  expect(container.querySelector(`.${styles.count}`)).toBeNull();
});

test("pad adds the pad class to the body", () => {
  const { container, rerender } = render(
    <Panel title="X">
      <p>a</p>
    </Panel>,
  );
  expect(container.querySelector(`.${styles.panelBody}`)).not.toBeNull();
  expect(
    container.querySelector(`.${styles.panelBody}.${styles.pad}`),
  ).toBeNull();

  rerender(
    <Panel title="X" pad>
      <p>a</p>
    </Panel>,
  );
  expect(
    container.querySelector(`.${styles.panelBody}.${styles.pad}`),
  ).not.toBeNull();
});
