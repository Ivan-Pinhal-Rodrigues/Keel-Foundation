"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cx } from "@/components/cx";
import { Pill, type PillTone } from "@/components/Pill";
import styles from "./ApprovalPanel.module.css";

/**
 * The shared approval panel (spec 04 §8). Presentational: it renders an approval
 * request's ordered steps and their decisions, and — when the viewer is the
 * holder of the current step's hat — the decide controls. It never talks to the
 * API. The consumer (the change drawer, Task 13) passes `onDecision`, which does
 * the `POST /api/changes/:id/approve/:tier` and re-fetches.
 *
 * The decide controls appear only when ALL of:
 *   - `state.status === "PENDING"` (defence in depth — `serializeApprovalState`
 *     already nulls `currentStep` for a resolved request, but a rejected request
 *     whose step 2 is still PENDING could otherwise leak a step here);
 *   - `state.currentStep != null`;
 *   - the viewer holds `state.currentStep.requiredHat`.
 *
 * With `state.needsOverride` (the viewer is the change owner, so a plain
 * approval is a separation-of-duties violation) the only control is
 * "Override & approve", which opens a dialog for the >= 20-char justification.
 */

const MIN_JUSTIFICATION = 20;

export type ApprovalStepView = {
  id: string;
  order: number;
  requiredHat: string;
  status: string; // "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED"
  decision: {
    actorName: string;
    decision: string;
    reason: string;
    isSingleApproverOverride: boolean;
    overrideJustification: string | null;
    decidedAt: string;
  } | null;
};

export type ApprovalPanelState = {
  status: string | null; // "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | null
  steps: ApprovalStepView[];
  currentStep: { id: string; requiredHat: string } | null;
  needsOverride: boolean;
};

export type ApprovalPanelProps = {
  state: ApprovalPanelState;
  viewer: { id: string; hats: string[] };
  onDecision: (input: {
    decision: "APPROVED" | "REJECTED";
    reason: string;
    overrideJustification?: string;
  }) => Promise<void>;
  busy?: boolean;
};

const STEP_TONE: Record<string, PillTone> = {
  APPROVED: "ok",
  REJECTED: "crit",
  SKIPPED: "info",
  PENDING: "info",
};

const STEP_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SKIPPED: "Skipped",
  PENDING: "Awaiting decision",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

function Banner({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <p className={cx(styles.banner, styles[`banner_${tone}` as const])}>
      {children}
    </p>
  );
}

function StatusBanner({ status }: { status: string | null }) {
  if (status == null) {
    return <Banner tone="info">Not yet submitted for approval.</Banner>;
  }
  if (status === "REJECTED") {
    return (
      <Banner tone="crit">
        Approval was rejected — the change returned to assessing.
      </Banner>
    );
  }
  if (status === "APPROVED") {
    return <Banner tone="ok">Approved.</Banner>;
  }
  if (status === "CANCELLED") {
    return <Banner tone="info">This approval request was cancelled.</Banner>;
  }
  return null;
}

function StepRow({ step }: { step: ApprovalStepView }) {
  const d = step.decision;
  return (
    <li className={styles.step}>
      <div className={styles.stepHead}>
        <span className={styles.stepOrder}>Step {step.order}</span>
        <Pill tone="accent">{step.requiredHat}</Pill>
        <Pill tone={STEP_TONE[step.status] ?? "info"} dot>
          {STEP_LABEL[step.status] ?? step.status}
        </Pill>
      </div>
      {d ? (
        <div className={styles.decision}>
          <div className={styles.decisionMeta}>
            <span className={styles.actor}>{d.actorName}</span>
            <span className={styles.muted}>{relativeTime(d.decidedAt)}</span>
            {d.isSingleApproverOverride ? (
              <span className={styles.overrideBadge}>
                Single-approver override
              </span>
            ) : null}
          </div>
          <p className={styles.reason}>{d.reason}</p>
          {d.isSingleApproverOverride && d.overrideJustification ? (
            <p className={styles.justification}>{d.overrideJustification}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function DecideControls({
  onDecision,
  busy,
}: {
  onDecision: ApprovalPanelProps["onDecision"];
  busy?: boolean;
}) {
  const [mode, setMode] = useState<null | "APPROVED" | "REJECTED">(null);
  const [reason, setReason] = useState("");
  const ready = reason.trim().length >= 1;

  function pick(next: "APPROVED" | "REJECTED") {
    setMode((cur) => (cur === next ? null : next));
    setReason("");
  }

  return (
    <div className={styles.controls}>
      <div className={styles.controlRow}>
        <button
          type="button"
          className={cx(styles.btn, mode === "APPROVED" && styles.btnActive)}
          onClick={() => pick("APPROVED")}
          disabled={busy}
        >
          Approve
        </button>
        <button
          type="button"
          className={cx(
            styles.btnGhost,
            mode === "REJECTED" && styles.btnActive,
          )}
          onClick={() => pick("REJECTED")}
          disabled={busy}
        >
          Reject
        </button>
      </div>
      {mode ? (
        <div className={styles.field}>
          <textarea
            className={styles.textarea}
            rows={3}
            aria-label={
              mode === "APPROVED"
                ? "Reason for approval"
                : "Reason for rejection"
            }
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Record why."
          />
          <button
            type="button"
            className={styles.btn}
            onClick={() =>
              void onDecision({ decision: mode, reason: reason.trim() })
            }
            disabled={!ready || busy}
          >
            {busy
              ? "Recording…"
              : mode === "APPROVED"
                ? "Confirm approval"
                : "Confirm rejection"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function OverrideControl({
  onDecision,
  busy,
}: {
  onDecision: ApprovalPanelProps["onDecision"];
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue("");
    const t = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const trimmed = value.trim().length;
  const ready = trimmed >= MIN_JUSTIFICATION;

  function close() {
    if (busy) return;
    setOpen(false);
  }

  return (
    <div className={styles.controls}>
      <button
        type="button"
        className={styles.btn}
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        Override &amp; approve
      </button>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.scrim} />
          <Dialog.Content className={styles.modal} aria-describedby={undefined}>
            <Dialog.Title className={styles.modalTitle}>
              Single-approver override
            </Dialog.Title>
            <p className={styles.modalLead}>
              You own this change, so no separate approver is recording this
              decision. This decision will be recorded in the audit log as a
              single-approver override.
            </p>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={4}
              aria-label="Override justification"
              placeholder="Explain why a single approver is acceptable here…"
            />
            <div
              className={cx(styles.counter, ready && styles.counterOk)}
              aria-live="polite"
            >
              {trimmed} / {MIN_JUSTIFICATION} characters minimum
            </div>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={close}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => {
                  const justification = value.trim();
                  void onDecision({
                    decision: "APPROVED",
                    reason: justification,
                    overrideJustification: justification,
                  });
                }}
                disabled={!ready || busy}
              >
                {busy ? "Recording…" : "Confirm override"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export function ApprovalPanel({
  state,
  viewer,
  onDecision,
  busy,
}: ApprovalPanelProps): ReactNode {
  const cs = state.currentStep;
  const canDecide =
    state.status === "PENDING" &&
    cs != null &&
    viewer.hats.includes(cs.requiredHat);

  return (
    <div className={styles.panel}>
      <StatusBanner status={state.status} />

      {state.steps.length > 0 ? (
        <ol className={styles.steps}>
          {state.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </ol>
      ) : null}

      {canDecide ? (
        state.needsOverride ? (
          <OverrideControl onDecision={onDecision} busy={busy} />
        ) : (
          <DecideControls onDecision={onDecision} busy={busy} />
        )
      ) : null}
    </div>
  );
}
