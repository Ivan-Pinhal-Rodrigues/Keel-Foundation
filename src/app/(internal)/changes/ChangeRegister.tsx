"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, LifecyclePips, type Column } from "@/components/DataTable";
import {
  Pill,
  RiskLabel,
  type PillTone,
  type RiskLevel,
} from "@/components/Pill";
import { CHANGE_STAGES } from "@/server/modules/change/state";
import { ChangeDrawer, type ChangeViewer } from "./ChangeDrawer";
import styles from "./changes.module.css";

/**
 * The internal change register — a `DataTable` + a filter-chip toolbar
 * (`plans/plan-03-change-approvals` Task 12, spec 03 §8.1).
 *
 * `page.tsx` has already scoped and filtered the rows server-side; the chips
 * filter the same set again on the client so they feel instant, and also write
 * the URL (`router.push`) so a reload lands on the same view. A row click sets
 * `openId`, which mounts `<ChangeDrawer>` (a Task 13 stub for now). The register
 * also reads `?open=<id>` on mount — the deep link `/approvals` builds — and
 * opens that change's drawer straight away.
 */

export type ChangeRow = {
  id: string;
  ref: string;
  title: string;
  riskLevel: RiskLevel | null;
  status: string;
  stage: string | null;
  originatingDemandRef: string | null;
  /** ISO 8601 timestamp, or null when the change has no window yet. */
  windowStart: string | null;
  windowEnd: string | null;
  ownerId: string;
};

export type RegisterFilters = {
  status?: string;
  mine?: boolean;
  scheduled?: boolean;
};

const CHANGE_STATUSES = [
  "DRAFT",
  "ASSESSING",
  "APPROVAL",
  "SCHEDULED",
  "IMPLEMENTING",
  "PIR",
  "CLOSED",
  "ROLLED_BACK",
] as const;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ASSESSING: "Assessing",
  APPROVAL: "In approval",
  SCHEDULED: "Scheduled",
  IMPLEMENTING: "Implementing",
  PIR: "Reviewing",
  CLOSED: "Closed",
  ROLLED_BACK: "Rolled back",
};

/** The seven stage labels the pips are drawn from (Draft … Closed). */
const CHANGE_STAGE_LABELS = CHANGE_STAGES.map((s) => s.label);

/** `ROLLED_BACK` is a terminal override, not a stage — it parks on Implementing. */
const IMPLEMENTING_INDEX = 4;

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function statusTone(status: string): PillTone {
  if (status === "CLOSED") return "ok";
  if (status === "ROLLED_BACK") return "crit";
  if (status === "IMPLEMENTING" || status === "SCHEDULED") return "warn";
  return "info";
}

function currentIndexFor(status: string): number {
  if (status === "ROLLED_BACK") return IMPLEMENTING_INDEX;
  return CHANGE_STAGES.findIndex((s) => s.status === status);
}

function formatWindow(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "—";
  const day = s.toISOString().slice(0, 10);
  const from = s.toISOString().slice(11, 16);
  const to = e.toISOString().slice(11, 16);
  return `${day} ${from}–${to}`;
}

export function ChangeRegister({
  initialRows,
  initialFilters,
  viewer,
}: {
  initialRows: ChangeRow[];
  initialFilters: RegisterFilters;
  viewer: ChangeViewer;
}) {
  const router = useRouter();
  const openParam = useSearchParams().get("open");

  const [status, setStatus] = useState<string | undefined>(
    initialFilters.status,
  );
  const [mine, setMine] = useState(Boolean(initialFilters.mine));
  const [scheduled, setScheduled] = useState(Boolean(initialFilters.scheduled));
  const [openId, setOpenId] = useState<string | null>(openParam);

  function buildQuery(next: {
    status?: string;
    mine: boolean;
    scheduled: boolean;
  }): string {
    const params = new URLSearchParams();
    if (next.status) params.set("status", next.status);
    if (next.mine) params.set("mine", "true");
    if (next.scheduled) params.set("scheduled", "true");
    const qs = params.toString();
    return qs ? `/changes?${qs}` : "/changes";
  }

  function pushQuery(next: {
    status?: string;
    mine: boolean;
    scheduled: boolean;
  }) {
    router.push(buildQuery(next));
  }

  function toggleStatus(next: string) {
    const value = status === next ? undefined : next;
    setStatus(value);
    pushQuery({ status: value, mine, scheduled });
  }

  function toggleMine() {
    const value = !mine;
    setMine(value);
    pushQuery({ status, mine: value, scheduled });
  }

  function toggleScheduled() {
    const value = !scheduled;
    setScheduled(value);
    pushQuery({ status, mine, scheduled: value });
  }

  function closeDrawer() {
    setOpenId(null);
    router.push(buildQuery({ status, mine, scheduled }));
  }

  const visibleRows = useMemo(() => {
    let rows = initialRows;
    if (status) rows = rows.filter((r) => r.status === status);
    if (mine) rows = rows.filter((r) => r.ownerId === viewer.id);
    if (scheduled) rows = rows.filter((r) => r.status === "SCHEDULED");
    return rows;
  }, [initialRows, status, mine, scheduled, viewer.id]);

  const columns: Column<ChangeRow>[] = [
    {
      key: "ref",
      header: "Ref",
      width: "112px",
      // Bare text — not wrapped — so DataTable's row activator gets a per-row
      // name ("Open Change register: CHG-0001").
      cell: (r) => r.ref,
    },
    {
      key: "title",
      header: "Title",
      cell: (r) => <span className={styles.title}>{r.title}</span>,
    },
    {
      key: "risk",
      header: "Risk",
      width: "96px",
      cell: (r) =>
        r.riskLevel ? (
          <RiskLabel level={r.riskLevel} />
        ) : (
          <span className={styles.muted}>—</span>
        ),
    },
    {
      key: "lifecycle",
      header: "Lifecycle",
      width: "180px",
      cell: (r) => (
        <span className={styles.lifecycleCell}>
          <LifecyclePips
            stages={CHANGE_STAGE_LABELS}
            currentIndex={currentIndexFor(r.status)}
            parkedIndex={
              r.status === "ROLLED_BACK" ? IMPLEMENTING_INDEX : undefined
            }
          />
          <Pill tone={statusTone(r.status)}>{statusLabel(r.status)}</Pill>
        </span>
      ),
    },
    {
      key: "demand",
      header: "From demand",
      width: "128px",
      cell: (r) =>
        r.originatingDemandRef ? (
          <span className={styles.demandRef}>{r.originatingDemandRef}</span>
        ) : (
          <span className={styles.muted}>—</span>
        ),
    },
    {
      key: "window",
      header: "Window",
      width: "168px",
      cell: (r) => (
        <span className={styles.windowCell}>
          {formatWindow(r.windowStart, r.windowEnd)}
        </span>
      ),
    },
  ];

  return (
    <section className={styles.register} aria-label="Change register">
      <div className={styles.toolbar}>
        <div className={styles.chips} role="group" aria-label="Filter changes">
          {CHANGE_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.chip}
              aria-pressed={status === s}
              onClick={() => toggleStatus(s)}
            >
              {statusLabel(s)}
            </button>
          ))}
          <button
            type="button"
            className={styles.chip}
            aria-pressed={scheduled}
            onClick={toggleScheduled}
          >
            Scheduled
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

      <DataTable
        label="Change register"
        columns={columns}
        rows={visibleRows}
        getRowId={(r) => r.id}
        onRowClick={(row) => setOpenId(row.id)}
      />

      {visibleRows.length === 0 ? (
        <p className={styles.empty} role="status">
          No changes match these filters.
        </p>
      ) : null}

      {openId ? (
        <ChangeDrawer id={openId} open onClose={closeDrawer} viewer={viewer} />
      ) : null}
    </section>
  );
}
