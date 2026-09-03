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

const EM_DASH = "—";
const ARROW = "→";

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

/** `assess` current, but with both of its gate items already checked. */
const STAGES_ASSESS_COMPLETE: Stage[] = [
  STAGES[0]!,
  {
    ...STAGES[1]!,
    gate: [
      { key: "b", label: "B", done: true },
      { key: "c", label: "C", done: true },
    ],
  },
  STAGES[2]!,
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

test("the Advance label names the next stage and ends with an arrow", () => {
  renderStepper({ canAdvance: true });
  const label = screen.getByRole("button", {
    name: /advance to build/i,
  }).textContent;
  expect(label).toBe(`Advance to Build ${ARROW}`);
});

test("the Advance label is plain 'Advance' on the last stage", () => {
  render(
    <LifecycleStepper stages={STAGES} currentStageKey="build" canAdvance />,
  );
  expect(screen.getByRole("button", { name: /advance/i }).textContent).toBe(
    "Advance",
  );
});

test("clicking the current stage's gate box calls onToggleGate with the negated value", async () => {
  const user = userEvent.setup();
  const { onToggleGate } = renderStepper();

  await user.click(screen.getByRole("checkbox", { name: "B" }));
  expect(onToggleGate).toHaveBeenCalledWith("assess", "b", true);
});

test("only the current stage's gate boxes are interactive", async () => {
  const user = userEvent.setup();
  const { onToggleGate } = renderStepper();

  // gate "A" belongs to `intake`, a past (done) stage
  const pastBox = screen.getByRole("checkbox", { name: "A" });
  expect(isDisabled(pastBox)).toBe(true);
  await user.click(pastBox);
  expect(onToggleGate).not.toHaveBeenCalled();

  // the current stage's box still works
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

test("the gate box is named via aria-labelledby, not a duplicate aria-label", () => {
  renderStepper();
  const box = screen.getByRole("checkbox", { name: "B" });
  expect(box.hasAttribute("aria-label")).toBe(false);
  const labelledBy = box.getAttribute("aria-labelledby");
  expect(labelledBy).toBeTruthy();
  expect(document.getElementById(labelledBy ?? "")?.textContent).toContain("B");
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

  expect(count()?.textContent).toBe("0/2");
  expect(count()?.matches(`.${styles.ok}`)).toBe(false);

  rerender(
    <LifecycleStepper
      stages={STAGES_ASSESS_COMPLETE}
      currentStageKey="assess"
      canAdvance
    />,
  );
  expect(count()?.textContent).toBe("2/2");
  expect(count()?.matches(`.${styles.ok}`)).toBe(true);
});

test("a gateless stage shows an em dash, not 0/0", () => {
  const { container } = renderStepper();
  const buildCount = container
    .querySelector(`.${styles.upcoming}`)
    ?.querySelector(`.${styles.stepCount}`);
  expect(buildCount?.textContent).toBe(EM_DASH);
});

test("an upcoming stage with gates shows the check count, not 0/N progress", () => {
  const { container } = render(
    <LifecycleStepper
      stages={[
        { key: "now", label: "Now", purpose: "here", gate: [] },
        {
          key: "later",
          label: "Later",
          purpose: "soon",
          gate: [
            { key: "p", label: "P", done: false },
            { key: "q", label: "Q", done: false },
          ],
        },
      ]}
      currentStageKey="now"
      canAdvance={false}
    />,
  );
  const laterCount = container
    .querySelector(`.${styles.upcoming}`)
    ?.querySelector(`.${styles.stepCount}`);
  expect(laterCount?.textContent).toBe("2 checks");
  expect(laterCount?.matches(`.${styles.ok}`)).toBe(false);
});

test("the advance hint shows gate progress only while gates are incomplete", () => {
  const { rerender } = renderStepper({ canAdvance: false });
  expect(screen.getByText(`0/2 gate checks to advance`)).toBeTruthy();

  // every gate checked, but the server still says canAdvance=false: the
  // component cannot know why, so it shows no hint (not "2/2 checks to advance")
  rerender(
    <LifecycleStepper
      stages={STAGES_ASSESS_COMPLETE}
      currentStageKey="assess"
      canAdvance={false}
    />,
  );
  expect(screen.queryByText(/gate checks to advance/i)).toBeNull();
  expect(isDisabled(screen.getByRole("button", { name: /advance/i }))).toBe(
    true,
  );
});

test("gate hint renders when present", () => {
  renderStepper();
  expect(screen.getByText("peer review")).toBeTruthy();
});

// --- Phase 1 amendment (plan-1a Task 8): blockedReason + Stage.state override ---

test("blockedReason renders under a disabled Advance once every current-stage gate is checked", () => {
  render(
    <LifecycleStepper
      stages={STAGES_ASSESS_COMPLETE}
      currentStageKey="assess"
      canAdvance={false}
      blockedReason="Waiting on technical approval"
      onAdvance={vi.fn()}
    />,
  );
  expect(isDisabled(screen.getByRole("button", { name: /advance/i }))).toBe(
    true,
  );
  expect(screen.getByText("Waiting on technical approval")).toBeTruthy();
  // it stands in for the gate-count hint, which is not shown now
  expect(screen.queryByText(/gate checks to advance/i)).toBeNull();
});

test("the gate-count hint still wins while gates are incomplete — blockedReason is ignored then", () => {
  render(
    <LifecycleStepper
      stages={STAGES}
      currentStageKey="assess"
      canAdvance={false}
      blockedReason="Waiting on technical approval"
    />,
  );
  expect(screen.getByText("0/2 gate checks to advance")).toBeTruthy();
  expect(screen.queryByText("Waiting on technical approval")).toBeNull();
});

test("an explicit Stage.state overrides the derived state — every step reverted, no Advance", () => {
  const reverted: Stage[] = STAGES.map((s) => ({
    ...s,
    state: "reverted" as const,
  }));
  const { container } = render(
    <LifecycleStepper
      stages={reverted}
      currentStageKey="assess"
      canAdvance={false}
    />,
  );
  const steps = container.querySelectorAll(`.${styles.step}`);
  expect(steps).toHaveLength(3);
  for (const step of steps) {
    expect(step.matches(`.${styles.reverted}`)).toBe(true);
    expect(step.matches(`.${styles.current}`)).toBe(false);
  }
  // a stage with an explicit state never shows an Advance button
  expect(screen.queryByRole("button", { name: /advance/i })).toBeNull();
});

test("a stage with an explicit state override is inert — gates non-interactive, no Advance", async () => {
  const user = userEvent.setup();
  const onToggleGate = vi.fn();
  const blocked: Stage[] = STAGES.map((s) =>
    s.key === "assess" ? { ...s, state: "blocked" as const } : s,
  );
  const { container } = render(
    <LifecycleStepper
      stages={blocked}
      currentStageKey="assess"
      canAdvance={false}
      onToggleGate={onToggleGate}
    />,
  );
  const assessStep = container.querySelectorAll(`.${styles.step}`)[1];
  expect(assessStep?.matches(`.${styles.blocked}`)).toBe(true);

  const box = screen.getByRole("checkbox", { name: "B" });
  expect(isDisabled(box)).toBe(true);
  await user.click(box);
  expect(onToggleGate).not.toHaveBeenCalled();

  expect(screen.queryByRole("button", { name: /advance/i })).toBeNull();
});
