"use client";

import { useId } from "react";
import { cx } from "@/components/cx";
import styles from "./LifecycleStepper.module.css";

export type GateItem = {
  key: string;
  label: string;
  hint?: string;
  done: boolean;
};

export type Stage = {
  key: string;
  label: string;
  purpose: string;
  gate: GateItem[];
  /**
   * Override the state the component would derive from `currentStageKey` and
   * array order. Pass `"blocked"` for a stage the server reports stuck, or
   * `"reverted"` on every stage to show a rolled-back change (otherwise its
   * stepper reads as entirely un-started). An explicit `state` WINS over the
   * derived one, and the stage is then inert — no interactive gate boxes, no
   * Advance button, even if `currentStageKey` also points at it.
   */
  state?: "done" | "current" | "upcoming" | "blocked" | "reverted";
};

export type LifecycleStepperProps = {
  stages: Stage[];
  currentStageKey: string;
  /** Server-computed. The component never recomputes it from gate state. */
  canAdvance: boolean;
  /**
   * Shown under a disabled Advance once every current-stage gate is checked —
   * the non-gate reason the server knows (approval pending, no deployment
   * window). While gates are still incomplete the gate-count hint wins and this
   * is not shown.
   */
  blockedReason?: string;
  /** `done` is the NEXT value for the gate item. */
  onToggleGate?: (stageKey: string, gateKey: string, done: boolean) => void;
  onAdvance?: (fromStageKey: string) => void;
  readOnly?: boolean;
};

type DerivedState = "done" | "current" | "upcoming";
type StageState = DerivedState | "blocked" | "reverted";

function CheckIcon() {
  return (
    <svg viewBox="0 0 14 14" className={styles.ck} aria-hidden="true">
      <path d="M3 7.5l3 3 5-6" />
    </svg>
  );
}

/**
 * Ported lifecycle stepper: a vertical rail of stages, each with its exit-gate
 * checklist and — on the current stage — a gated Advance button. Client
 * component (gate toggles + advance are handlers).
 *
 * Stage state is derived from `currentStageKey` and array order: earlier stages
 * are done, the matching one is current, later ones upcoming. A `Stage.state`
 * value overrides that derivation — `"blocked"` for a server-reported stuck
 * stage, `"reverted"` on every stage for a rolled-back change — and a stage
 * with an explicit state is inert (no interactive gates, no Advance).
 *
 * Only the current stage's gate boxes are interactive — checking a future
 * stage's exit gate or re-opening a past one is not a sensible operation, so
 * those render read-only. `canAdvance` gates the Advance button and is taken
 * verbatim from props; the component never recomputes it from gate state. Pass
 * `blockedReason` to explain a disabled Advance whose gates are all checked.
 */
export function LifecycleStepper({
  stages,
  currentStageKey,
  canAdvance,
  blockedReason,
  onToggleGate,
  onAdvance,
  readOnly,
}: LifecycleStepperProps) {
  const baseId = useId();
  const currentIndex = stages.findIndex((s) => s.key === currentStageKey);
  const nextStage = currentIndex >= 0 ? stages[currentIndex + 1] : undefined;

  return (
    <div className={styles.stepper}>
      {stages.map((stage, stageIndex) => {
        const derived: DerivedState =
          currentIndex >= 0 && stageIndex < currentIndex
            ? "done"
            : stageIndex === currentIndex
              ? "current"
              : "upcoming";
        // An explicit `Stage.state` wins over the derived state. Such a stage is
        // a server-set display state (stuck / rolled back) and is inert.
        const state: StageState = stage.state ?? derived;
        const overridden = stage.state != null;

        const total = stage.gate.length;
        const doneCount = stage.gate.filter((item) => item.done).length;
        // Prototype rules (~line 1797): gateless -> em dash; a non-active stage
        // (upcoming, or a blocked/reverted override) shows the check count, not
        // 0/N progress; otherwise done/total. The all-done "ok" tint only
        // applies to the done / current stages.
        const countLabel =
          total === 0
            ? "—"
            : state === "done" || state === "current"
              ? `${doneCount}/${total}`
              : `${total} checks`;
        const countIsOk =
          total > 0 &&
          doneCount === total &&
          (state === "done" || state === "current");

        // upcoming / blocked / reverted all render the stage number in the node;
        // done renders a check, current a dot.
        const numbered =
          state === "upcoming" || state === "blocked" || state === "reverted";

        // The Advance row and interactive gates belong to the DERIVED current
        // stage only, and never to a stage the caller has pinned with `state`.
        const isLiveCurrent = derived === "current" && !readOnly && !overridden;

        return (
          <div key={stage.key} className={cx(styles.step, styles[state])}>
            <div className={styles.stepRail}>
              <span className={cx(styles.stepNode, numbered && styles.refNum)}>
                {state === "done" ? (
                  <CheckIcon />
                ) : state === "current" ? (
                  <span className={styles.stepCur} />
                ) : (
                  stageIndex + 1
                )}
              </span>
            </div>

            <div className={styles.stepMain}>
              <div className={styles.stepHead}>
                <span className={styles.stepLabel}>{stage.label}</span>
                <span className={cx(styles.stepCount, countIsOk && styles.ok)}>
                  {countLabel}
                </span>
              </div>
              <div className={styles.stepPurpose}>{stage.purpose}</div>

              {total > 0 ? (
                <ul className={styles.gate}>
                  {stage.gate.map((item, itemIndex) => {
                    const labelId = `${baseId}-gate-${stageIndex}-${itemIndex}`;
                    return (
                      <li
                        key={item.key}
                        className={cx(item.done && styles.done)}
                      >
                        <button
                          type="button"
                          className={styles.gateBox}
                          role="checkbox"
                          aria-checked={item.done}
                          aria-labelledby={labelId}
                          disabled={!isLiveCurrent}
                          onClick={() => {
                            if (!isLiveCurrent) return;
                            onToggleGate?.(stage.key, item.key, !item.done);
                          }}
                        >
                          {item.done ? <CheckIcon /> : null}
                        </button>
                        <span id={labelId} className={styles.gateT}>
                          {item.label}
                          {item.hint ? (
                            <span className={styles.gateHint}>{item.hint}</span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {isLiveCurrent ? (
                <div className={styles.advanceRow}>
                  <button
                    type="button"
                    className={styles.advance}
                    disabled={!canAdvance || !!readOnly}
                    onClick={() => onAdvance?.(currentStageKey)}
                  >
                    {nextStage ? `Advance to ${nextStage.label} →` : "Advance"}
                  </button>
                  {/* Hint under a disabled Advance: the gate-count while gates
                      are incomplete; otherwise the server's non-gate reason
                      (`blockedReason`) if given; otherwise nothing — the
                      component cannot infer the reason itself. */}
                  {!canAdvance && doneCount < total ? (
                    <span className={styles.advanceHint}>
                      {doneCount}/{total} gate checks to advance
                    </span>
                  ) : !canAdvance && blockedReason ? (
                    <span className={styles.advanceHint}>{blockedReason}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
