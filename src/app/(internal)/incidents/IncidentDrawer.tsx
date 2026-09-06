"use client";

import { useEffect, useState } from "react";
import { Drawer } from "@/components/Drawer";
import { Pill, type PillTone } from "@/components/Pill";
import { ApiError, apiFetch } from "@/lib/api/client";
import styles from "./IncidentDrawer.module.css";

/**
 * Incident drawer — STUB for Task 9.
 *
 * Task 8 (the register) needs a real, mountable drawer so the card-click path
 * can be tested, but the full incident detail view (activity timeline, comment
 * thread, categorise / assign / transition actions) is Task 9's job. This
 * version fetches `GET /api/incidents/:id` through `apiFetch` (never a bare
 * `fetch` — Global Constraint) and shows just the ref / title / status. Task 9
 * replaces the whole body.
 */

export type IncidentViewer = {
  id: string;
  kind: string;
  hats: string[];
};

type IncidentView = {
  id: string;
  ref: string;
  title: string;
  status: string;
};

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

function statusTone(status: string): PillTone {
  if (status === "RESOLVED" || status === "CLOSED") return "ok";
  if (status === "IN_PROGRESS") return "warn";
  return "info";
}

export function IncidentDrawer({
  id,
  open,
  onClose,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  viewer: IncidentViewer;
}) {
  const [incident, setIncident] = useState<IncidentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<IncidentView>(`/api/incidents/${id}`)
      .then((data) => {
        if (!cancelled) setIncident(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError && e.status === 404
            ? "This incident could not be found."
            : "Something went wrong loading this incident.",
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
      title={incident?.title ?? "Incident"}
      idLabel={incident?.ref ?? ""}
    >
      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : incident ? (
        <div className={styles.body}>
          <Pill tone={statusTone(incident.status)}>
            {STATUS_LABELS[incident.status] ?? incident.status}
          </Pill>
          <p className={styles.muted}>
            The full incident view arrives in Task 9.
          </p>
        </div>
      ) : null}
    </Drawer>
  );
}
