"use client";

import { useEffect, useState } from "react";
import { Drawer } from "@/components/Drawer";
import { Pill } from "@/components/Pill";
import { ApiError, apiFetch } from "@/lib/api/client";
import styles from "./ChangeDrawer.module.css";

/**
 * The change drawer — a minimal real STUB for Task 12.
 *
 * Task 13 replaces this file with the full change drawer (the lifecycle
 * stepper, the approval panel, the edit / schedule / advance / rollback / PIR
 * write actions). It must keep BOTH exports below and the same prop contract
 * (`{ id, open, onClose, viewer }`) so `ChangeRegister` needs no change.
 *
 * For now: open it and it fetches `GET /api/changes/:id` through `apiFetch`
 * (never a bare `fetch` — Global Constraint) and shows the ref, title, and
 * status. Everything else is a "the full view arrives in Task 13" line.
 */

export type ChangeViewer = {
  id: string;
  kind: string;
  hats: string[];
};

type ChangeView = {
  id: string;
  ref: string;
  title: string;
  status: string;
  statusLabel?: string;
};

export function ChangeDrawer({
  id,
  open,
  onClose,
  viewer,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  /** Threaded through for Task 13's write-action gating; unused by the stub. */
  viewer: ChangeViewer;
}) {
  void viewer;
  const [change, setChange] = useState<ChangeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<ChangeView>(`/api/changes/${id}`)
      .then((data) => {
        if (!cancelled) setChange(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError && e.status === 404
            ? "This change could not be found."
            : "Something went wrong loading this change.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, id]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={change?.title ?? "Change"}
      idLabel={change?.ref ?? ""}
    >
      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : change ? (
        <div className={styles.body}>
          <div className={styles.statusRow}>
            <Pill tone="info">{change.statusLabel ?? change.status}</Pill>
          </div>
          <p className={styles.muted}>
            The full change view — lifecycle stepper, approvals, and the write
            actions — arrives in Task 13.
          </p>
        </div>
      ) : null}
    </Drawer>
  );
}
