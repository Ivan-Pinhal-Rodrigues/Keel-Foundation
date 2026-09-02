"use client";

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
 * `canAdvance` gates the Advance button and is taken verbatim from props.
 */
export function LifecycleStepper({
  stages,
  currentStageKey,
  canAdvance,
  onToggleGate,
  onAdvance,
  readOnly,
}: LifecycleStepperProps) {
  const currentIndex = stages.findIndex((s) => s.key === currentStageKey);
  const nextStage = currentIndex >= 0 ? stages[currentIndex + 1] : undefined;

  return (
    <div className={styles.stepper}>
      {stages.map((stage, index) => {
        const state: StageState =
          currentIndex >= 0 && index < currentIndex
            ? "done"
            : index === currentIndex
              ? "current"
              : "upcoming";

        const total = stage.gate.length;
        const doneCount = stage.gate.filter((item) => item.done).length;
        const allDone = total > 0 && doneCount === total;

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
                  index + 1
                )}
              </span>
            </div>

            <div className={styles.stepMain}>
              <div className={styles.stepHead}>
                <span className={styles.stepLabel}>{stage.label}</span>
                <span className={cx(styles.stepCount, allDone && styles.ok)}>
                  {doneCount}/{total}
                </span>
              </div>
              <div className={styles.stepPurpose}>{stage.purpose}</div>

              {total > 0 ? (
                <ul className={styles.gate}>
                  {stage.gate.map((item) => (
                    <li key={item.key} className={cx(item.done && styles.done)}>
                      <button
                        type="button"
                        className={styles.gateBox}
                        role="checkbox"
                        aria-checked={item.done}
                        aria-label={item.label}
                        disabled={readOnly}
                        onClick={() =>
                          onToggleGate?.(stage.key, item.key, !item.done)
                        }
                      >
                        {item.done ? <CheckIcon /> : null}
                      </button>
                      <span className={styles.gateT}>
                        {item.label}
                        {item.hint ? (
                          <span className={styles.gateHint}>{item.hint}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
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
                    {nextStage ? `Advance to ${nextStage.label}` : "Advance"}
                  </button>
                  {!canAdvance ? (
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
