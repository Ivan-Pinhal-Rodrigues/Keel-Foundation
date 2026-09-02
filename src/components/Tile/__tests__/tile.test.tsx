/** @vitest-environment jsdom */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Tile } from "@/components/Tile";
import styles from "@/components/Tile/Tile.module.css";

afterEach(cleanup);

test("renders label, value and sub", () => {
  render(<Tile label="In register" value={42} sub="3 parked" />);
  expect(screen.getByText("In register")).toBeTruthy();
  expect(screen.getByText("42")).toBeTruthy();
  expect(screen.getByText("3 parked")).toBeTruthy();
});

test("renders a ReactNode value (e.g. a number with a unit)", () => {
  render(
    <Tile
      label="MTTR"
      value={
        <>
          41<small>m</small>
        </>
      }
    />,
  );
  expect(screen.getByText("m")).toBeTruthy();
});

test("omits the sub row when no sub is given", () => {
  const { container } = render(<Tile label="Active" value={0} />);
  expect(container.querySelector(`.${styles.sub}`)).toBeNull();
});

test("tone puts the matching marker on the tick", () => {
  const { container } = render(
    <Tile label="Emergency" value={1} sub="reviewed after" tone="crit" />,
  );
  const tick = container.querySelector(`.${styles.tick}`);
  expect(tick).not.toBeNull();
  expect(tick?.getAttribute("data-tone")).toBe("crit");
});

test("no tick without a tone, even when sub is present", () => {
  const { container } = render(
    <Tile label="Resolved" value={12} sub="all with follow-ups" />,
  );
  expect(container.querySelector(`.${styles.tick}`)).toBeNull();
});
