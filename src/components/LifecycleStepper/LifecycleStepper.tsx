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
};

export type LifecycleStepperProps = {
  stages: Stage[];
  currentStageKey: string;
  /** Server-computed. The component never recomputes it from gate state. */
  canAdvance: boolean;
  /** `done` is the NEXT value for the gate item. */
  onToggleGate?: (stageKey: string, gateKey: string, done: boolean) => void;
  onAdvance?: (fromStageKey: string) => void;
  readOnly?: boolean;
};

type StageState = "done" | "current" | "upcoming";

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
 * Stage state is derived purely from `currentStageKey` and array order:
 * earlier stages are done, the matching one is current, later ones upcoming.
 * Only the current stage's gate boxes are interactive — checking a future
 * stage's exit gate or re-opening a past one is not a sensible operation, so
 * those render read-only. `canAdvance` gates the Advance button and is taken
 * verbatim from props; the component never recomputes it from gate state.
 */
export function LifecycleStepper({
  stages,
  currentStageKey,
  canAdvance,
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
        const state: StageState =
          currentIndex >= 0 && stageIndex < currentIndex
            ? "done"
            : stageIndex === currentIndex
              ? "current"
              : "upcoming";

        const total = stage.gate.length;
        const doneCount = stage.gate.filter((item) => item.done).length;
        // Prototype rules (~line 1797): gateless -> em dash; an unstarted
        // (upcoming) stage shows the check count, not 0/N progress; otherwise
        // done/total. The all-done "ok" tint never applies to upcoming.
        const countLabel =
          total === 0
            ? "—"
            : state === "upcoming"
              ? `${total} checks`
              : `${doneCount}/${total}`;
        const countIsOk =
          total > 0 && doneCount === total && state !== "upcoming";

        const gatesInteractive = state === "current" && !readOnly;

        return (
          <div key={stage.key} className={cx(styles.step, styles[state])}>
            <div className={styles.stepRail}>
              <span
                className={cx(
                  styles.stepNode,
                  state === "upcoming" && styles.refNum,
                )}
              >
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
                          disabled={!gatesInteractive}
                          onClick={() => {
                            if (!gatesInteractive) return;
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

              {state === "current" && !readOnly ? (
                <div className={styles.advanceRow}>
                  <button
                    type="button"
                    className={styles.advance}
                    disabled={!canAdvance || !!readOnly}
                    onClick={() => onAdvance?.(currentStageKey)}
                  >
                    {nextStage ? `Advance to ${nextStage.label} →` : "Advance"}
                  </button>
                  {/* Only a gate-count hint. `canAdvance` can be false for a
                      non-gate reason (approval, window) with every gate checked
                      — the component can't know that reason, so it says nothing
                      once the gates are complete. */}
                  {!canAdvance && doneCount < total ? (
                    <span className={styles.advanceHint}>
                      {doneCount}/{total} gate checks to advance
                    </span>
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
