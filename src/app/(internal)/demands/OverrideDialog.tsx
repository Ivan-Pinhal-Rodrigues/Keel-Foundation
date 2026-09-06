"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/cx";
import styles from "./OverrideDialog.module.css";

/**
 * Single-approver override dialog (`plans/plan-01-demand.md` Task 7,
 * reconciliation ruling 4). A centred modal: a justification `<textarea>` with a
 * live character counter, Confirm disabled until the trimmed value is at least
 * `MIN_JUSTIFICATION` characters, Cancel. `onConfirm` hands the trimmed
 * justification back so the parent can re-issue `POST /decision` with
 * `overrideJustification`.
 *
 * Opened two ways from `DemandDrawer`: proactively when the viewer IS the
 * demand's submitter, or reactively when the server returns a 409
 * `{ overrideAction: "demand.decide.override" }`.
 */

const MIN_JUSTIFICATION = 20;

const DECISION_VERB: Record<string, string> = {
  PURSUE: "pursue",
  PARK: "park",
  DROP: "drop",
};

export function OverrideDialog({
  open,
  decision,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** The pending decision (`PURSUE` / `PARK` / `DROP`), for the prompt copy. */
  decision: string | null;
  busy?: boolean;
  onConfirm: (justification: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue("");
    // Focus the textarea once Radix has mounted and run its own focus logic.
    const t = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const trimmed = value.trim().length;
  const ready = trimmed >= MIN_JUSTIFICATION;
  const verb = decision ? (DECISION_VERB[decision] ?? "record") : "record";

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content className={styles.modal} aria-describedby={undefined}>
          <Dialog.Title className={styles.title}>
            Single-approver override
          </Dialog.Title>
          <p className={styles.lead}>
            You submitted this demand. Recording the decision to {verb} it
            yourself needs a written justification — it is logged to the audit
            trail.
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
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancel}
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.confirm}
              onClick={() => onConfirm(value.trim())}
              disabled={!ready || busy}
            >
              {busy ? "Recording…" : "Confirm override"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
