/** @vitest-environment jsdom */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EnvTag, Pill, PriorityTag, RiskLabel } from "@/components/Pill";
import styles from "@/components/Pill/Pill.module.css";

afterEach(cleanup);

test("Pill renders children and the tone class", () => {
  const { container } = render(<Pill tone="ok">Operational</Pill>);
  expect(screen.getByText("Operational")).toBeTruthy();
  expect(
    container.querySelector(`.${styles.pill}.${styles.ok}`),
  ).not.toBeNull();
});

test("Pill renders the dot span only when dot is set", () => {
  const { container, rerender } = render(<Pill tone="warn">Live</Pill>);
  expect(container.querySelector(`.${styles.pdot}`)).toBeNull();
  rerender(
    <Pill tone="warn" dot>
      Live
    </Pill>,
  );
  expect(container.querySelector(`.${styles.pdot}`)).not.toBeNull();
});

test("PriorityTag P1 has the p1 class and the text P1", () => {
  const { container } = render(<PriorityTag priority="P1" />);
  expect(screen.getByText("P1")).toBeTruthy();
  expect(container.querySelector(`.${styles.pri}.${styles.p1}`)).not.toBeNull();
});

test("PriorityTag P4 has a p4 class and the text P4", () => {
  const { container } = render(<PriorityTag priority="P4" />);
  expect(screen.getByText("P4")).toBeTruthy();
  expect(styles.p4).toBeTruthy(); // a real .p4 rule must exist in the module
  expect(container.querySelector(`.${styles.pri}.${styles.p4}`)).not.toBeNull();
});

test("RiskLabel HIGH has the high class and the text HIGH", () => {
  const { container } = render(<RiskLabel level="HIGH" />);
  expect(screen.getByText("HIGH")).toBeTruthy();
  expect(
    container.querySelector(`.${styles.risk}.${styles.high}`),
  ).not.toBeNull();
});

test("EnvTag prod has the prod class and the text prod", () => {
  const { container } = render(<EnvTag env="prod" />);
  expect(screen.getByText("prod")).toBeTruthy();
  expect(
    container.querySelector(`.${styles.env}.${styles.prod}`),
  ).not.toBeNull();
});
