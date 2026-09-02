/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LifecycleStepper } from "@/components/LifecycleStepper";
import type {
  LifecycleStepperProps,
  Stage,
} from "@/components/LifecycleStepper";
import styles from "@/components/LifecycleStepper/LifecycleStepper.module.css";

afterEach(cleanup);

const STAGES: Stage[] = [
  {
    key: "intake",
    label: "Intake",
    purpose: "Capture the request",
    gate: [{ key: "a", label: "A", done: true }],
  },
  {
    key: "assess",
    label: "Assess",
    purpose: "Weigh the change",
    gate: [
      { key: "b", label: "B", done: false },
      { key: "c", label: "C", hint: "peer review", done: false },
    ],
  },
  { key: "build", label: "Build", purpose: "Make it", gate: [] },
];

function isDisabled(el: Element | null | undefined): boolean {
  return el instanceof HTMLButtonElement && el.disabled;
}

function renderStepper(overrides: Partial<LifecycleStepperProps> = {}) {
  const onAdvance = vi.fn();
  const onToggleGate = vi.fn();
  const utils = render(
    <LifecycleStepper
      stages={STAGES}
      currentStageKey="assess"
      canAdvance={false}
      onAdvance={onAdvance}
      onToggleGate={onToggleGate}
      {...overrides}
    />,
  );
  return { onAdvance, onToggleGate, ...utils };
}

test("Advance is disabled until canAdvance, then calls onAdvance with the current stage key", async () => {
  const user = userEvent.setup();
  const { onAdvance, rerender } = renderStepper({ canAdvance: false });

  expect(isDisabled(screen.getByRole("button", { name: /advance/i }))).toBe(
    true,
  );

  rerender(
    <LifecycleStepper
      stages={STAGES}
      currentStageKey="assess"
      canAdvance
      onAdvance={onAdvance}
    />,
  );
  const enabled = screen.getByRole("button", { name: /advance/i });
  expect(isDisabled(enabled)).toBe(false);
  await user.click(enabled);
  expect(onAdvance).toHaveBeenCalledTimes(1);
  expect(onAdvance).toHaveBeenCalledWith("assess");
});

test("clicking a gate box calls onToggleGate with the stage key, gate key, and negated value", async () => {
  const user = userEvent.setup();
  const { onToggleGate } = renderStepper();

  await user.click(screen.getByRole("checkbox", { name: "B" }));
  expect(onToggleGate).toHaveBeenCalledWith("assess", "b", true);
});

test("readOnly: no Advance button, and gate boxes are disabled and inert", async () => {
  const user = userEvent.setup();
  const { onToggleGate } = renderStepper({ readOnly: true });

  expect(screen.queryByRole("button", { name: /advance/i })).toBeNull();

  const box = screen.getByRole("checkbox", { name: "B" });
  expect(isDisabled(box)).toBe(true);
  await user.click(box);
  expect(onToggleGate).not.toHaveBeenCalled();
});

test("stage visual state is derived from currentStageKey and array order", () => {
  const { container } = renderStepper();
  const steps = container.querySelectorAll(`.${styles.step}`);
  expect(steps).toHaveLength(3);
  expect(steps[0]?.matches(`.${styles.done}`)).toBe(true); // intake
  expect(steps[1]?.matches(`.${styles.current}`)).toBe(true); // assess
  expect(steps[2]?.matches(`.${styles.upcoming}`)).toBe(true); // build
});

test("the current stage step-count shows done/total and gains .ok only when all gate items are done", () => {
  const { container, rerender } = renderStepper();
  const count = () =>
    container
      .querySelector(`.${styles.current}`)
      ?.querySelector(`.${styles.stepCount}`);

  expect(count()?.textContent).toContain("0/2");
  expect(count()?.matches(`.${styles.ok}`)).toBe(false);

  rerender(
    <LifecycleStepper
      stages={[
        STAGES[0]!,
        {
          ...STAGES[1]!,
          gate: [
            { key: "b", label: "B", done: true },
            { key: "c", label: "C", done: true },
          ],
        },
        STAGES[2]!,
      ]}
      currentStageKey="assess"
      canAdvance
    />,
  );
  expect(count()?.textContent).toContain("2/2");
  expect(count()?.matches(`.${styles.ok}`)).toBe(true);
});

test("gate hint renders when present", () => {
  renderStepper();
  expect(screen.getByText("peer review")).toBeTruthy();
});
