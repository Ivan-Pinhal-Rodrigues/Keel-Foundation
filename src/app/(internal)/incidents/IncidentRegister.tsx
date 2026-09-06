"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IncidentCard, type IncidentRow } from "./IncidentCard";
import { IncidentDrawer, type IncidentViewer } from "./IncidentDrawer";
import styles from "./incidents.module.css";

/**
 * The internal incident register — a card list (spec §9.1), NOT a `DataTable`.
 *
 * `page.tsx` has already scoped and filtered the rows server-side; the chips /
 * toggles filter the same set again on the client so they feel instant, and
 * also write the URL (`router.push`) so a reload lands on the same view. A card
 * click sets `openId`, which mounts `<IncidentDrawer>` (a Task 9 stub for now).
 */

export type RegisterFilters = {
  status?: string;
  priority?: string;
  overdue?: boolean;
  mine?: boolean;
};

const STATUSES = [
  "NEW",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
] as const;

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;

function toMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function IncidentRegister({
  initialRows,
  initialFilters,
  viewer,
}: {
  initialRows: IncidentRow[];
  initialFilters: RegisterFilters;
  viewer: IncidentViewer;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string | undefined>(
    initialFilters.status,
  );
  const [priority, setPriority] = useState<string | undefined>(
    initialFilters.priority,
  );
  const [overdueOnly, setOverdueOnly] = useState(
    Boolean(initialFilters.overdue),
  );
  const [mine, setMine] = useState(Boolean(initialFilters.mine));
  const [openId, setOpenId] = useState<string | null>(null);

  function pushQuery(next: {
    status?: string;
    priority?: string;
    overdue: boolean;
    mine: boolean;
  }) {
    const params = new URLSearchParams();
    if (next.status) params.set("status", next.status);
    if (next.priority) params.set("priority", next.priority);
    if (next.overdue) params.set("overdue", "true");
    if (next.mine) params.set("mine", "true");
    const qs = params.toString();
    router.push(qs ? `/incidents?${qs}` : "/incidents");
  }

  function toggleStatus(next: string) {
    const value = status === next ? undefined : next;
    setStatus(value);
    pushQuery({ status: value, priority, overdue: overdueOnly, mine });
  }

  function togglePriority(next: string) {
    const value = priority === next ? undefined : next;
    setPriority(value);
    pushQuery({ status, priority: value, overdue: overdueOnly, mine });
  }

  function toggleOverdue() {
    const value = !overdueOnly;
    setOverdueOnly(value);
    pushQuery({ status, priority, overdue: value, mine });
  }

  function toggleMine() {
    const value = !mine;
    setMine(value);
    pushQuery({ status, priority, overdue: overdueOnly, mine: value });
  }

  const visibleRows = useMemo(() => {
    let rows = initialRows;
    if (status) rows = rows.filter((r) => r.status === status);
    if (priority) rows = rows.filter((r) => r.priority === priority);
    if (overdueOnly) rows = rows.filter((r) => r.overdue);
    if (mine) rows = rows.filter((r) => r.assigneeId === viewer.id);
    return [...rows].sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
  }, [initialRows, status, priority, overdueOnly, mine, viewer.id]);

  return (
    <section className={styles.register} aria-label="Incident register">
      <div className={styles.toolbar}>
        <div
          className={styles.chips}
          role="group"
          aria-label="Filter incidents"
        >
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.chip}
              aria-pressed={status === s}
              onClick={() => toggleStatus(s)}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              className={styles.chip}
              aria-pressed={priority === p}
              onClick={() => togglePriority(p)}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className={styles.chip}
            aria-pressed={overdueOnly}
            onClick={toggleOverdue}
          >
            Overdue only
          </button>
          <button
            type="button"
            className={styles.chip}
            aria-pressed={mine}
            onClick={toggleMine}
          >
            Mine
          </button>
        </div>
      </div>

      {visibleRows.length > 0 ? (
        <ul className={styles.cards}>
          {visibleRows.map((row) => (
            <li key={row.id}>
              <IncidentCard row={row} onOpen={setOpenId} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty} role="status">
          No incidents match these filters.
        </p>
      )}

      {openId ? (
        <IncidentDrawer
          id={openId}
          open
          onClose={() => setOpenId(null)}
          viewer={viewer}
        />
      ) : null}
    </section>
  );
}
