"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/DataTable";
import { Pill, type PillTone } from "@/components/Pill";
import { DemandDrawer, type DemandViewer } from "./DemandDrawer";
import styles from "./demands.module.css";

/**
 * The demand register — `DataTable` + a filter-chip / sort toolbar
 * (`plans/plan-01-demand.md` Task 5, spec 01 §8.1).
 *
 * The rows are already scoped and filtered server-side by `page.tsx`; the chips
 * filter the same set again on the client so they feel instant, and also write
 * the URL (`router.push`) so a reload lands on the same view. Row activation is
 * `DataTable`'s own (the visually-hidden per-row activator button + guarded
 * `<tr onClick>`); Task 6 turns `openId` into the `<DemandDrawer>`.
 */

export type DemandWorth = {
  effort?: string | null;
  valueScore?: number | null;
  costOfDelay?: string | null;
};

export type DemandRow = {
  id: string;
  ref: string;
  title: string;
  source: string;
  status: string;
  clientName?: string | null;
  worth?: DemandWorth | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
};

export type RegisterFilters = {
  status?: string;
  source?: string;
  mine?: boolean;
};

const DEMAND_STATUSES = [
  "SUBMITTED",
  "TRIAGING",
  "WORTH_ASSESSED",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
] as const;

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "Submitted",
  TRIAGING: "Triaging",
  WORTH_ASSESSED: "Worth assessed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CONVERTED: "Converted",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function statusTone(status: string): PillTone {
  if (status === "APPROVED") return "ok";
  if (status === "REJECTED") return "crit";
  return "info";
}

type SortKey = "newest" | "oldest" | "cod";

function toMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Compact relative age — "just now", "5m", "3h", "2d", "4mo", "1y". */
function relativeAge(iso: string): string {
  const then = toMs(iso);
  if (then === 0) return "—";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.round(months / 12)}y`;
}

/** Value score (0–10) rendered as up to five dots. */
function valueDots(score: number | null | undefined): number {
  return Math.max(0, Math.min(5, Math.round((score ?? 0) / 2)));
}

export function DemandRegister({
  initialRows,
  initialFilters,
  viewer,
}: {
  initialRows: DemandRow[];
  initialFilters: RegisterFilters;
  viewer: DemandViewer;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string | undefined>(
    initialFilters.status,
  );
  const [raisedByClient, setRaisedByClient] = useState(false);
  const [sort, setSort] = useState<SortKey>("newest");
  const [openId, setOpenId] = useState<string | null>(null);

  function pushQuery(nextStatus: string | undefined) {
    const params = new URLSearchParams();
    if (nextStatus) params.set("status", nextStatus);
    if (initialFilters.source) params.set("source", initialFilters.source);
    if (initialFilters.mine) params.set("mine", "true");
    const qs = params.toString();
    router.push(qs ? `/demands?${qs}` : "/demands");
  }

  function toggleStatus(next: string) {
    const value = status === next ? undefined : next;
    setStatus(value);
    pushQuery(value);
  }

  const visibleRows = useMemo(() => {
    let rows = initialRows;
    if (status) rows = rows.filter((r) => r.status === status);
    if (raisedByClient) rows = rows.filter((r) => r.clientName != null);

    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sort === "cod") {
        // v1 limitation: cost of delay is free text, so this sort can only use
        // its presence as a boolean tiebreak, then fall back to recency.
        const av = a.worth?.costOfDelay ? 1 : 0;
        const bv = b.worth?.costOfDelay ? 1 : 0;
        if (av !== bv) return bv - av;
        return toMs(b.createdAt) - toMs(a.createdAt);
      }
      const delta = toMs(b.createdAt) - toMs(a.createdAt);
      return sort === "oldest" ? -delta : delta;
    });
    return sorted;
  }, [initialRows, status, raisedByClient, sort]);

  const columns: Column<DemandRow>[] = [
    {
      key: "ref",
      header: "Ref",
      width: "108px",
      // Bare text — NOT wrapped in an element — so DataTable's row activator
      // gets a per-row name ("Open Demand register: DEM-0001").
      cell: (r) => r.ref,
    },
    {
      key: "title",
      header: "Title",
      cell: (r) => <span className={styles.title}>{r.title}</span>,
    },
    {
      key: "source",
      header: "Source",
      width: "128px",
      cell: (r) => <Pill tone="info">{r.source}</Pill>,
    },
    {
      key: "client",
      header: "Client",
      width: "184px",
      cell: (r) =>
        r.clientName ? (
          <span className={styles.clientCell}>
            <span>{r.clientName}</span>
            <span className={styles.clientMark}>raised by a client</span>
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      width: "132px",
      cell: (r) => (
        <Pill tone={statusTone(r.status)}>{statusLabel(r.status)}</Pill>
      ),
    },
    {
      key: "worth",
      header: "Value / effort",
      width: "124px",
      cell: (r) => (
        <span className={styles.worthCell}>
          <span className={styles.effort}>{r.worth?.effort ?? "—"}</span>
          <span aria-hidden="true" className={styles.dots}>
            {"●".repeat(valueDots(r.worth?.valueScore))}
          </span>
        </span>
      ),
    },
    {
      key: "age",
      header: "Age",
      width: "80px",
      cell: (r) => (
        <span className={styles.muted}>{relativeAge(r.createdAt)}</span>
      ),
    },
  ];

  return (
    <section className={styles.register} aria-label="Demand register">
      <div className={styles.toolbar}>
        <div className={styles.chips} role="group" aria-label="Filter demands">
          {DEMAND_STATUSES.map((s) => (
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
            aria-pressed={raisedByClient}
            onClick={() => setRaisedByClient((v) => !v)}
          >
            Raised by a client
          </button>
        </div>

        <label className={styles.sort}>
          <span className={styles.sortLabel}>Sort</span>
          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="cod">Cost of delay</option>
          </select>
        </label>
      </div>

      <DataTable
        label="Demand register"
        columns={columns}
        rows={visibleRows}
        getRowId={(r) => r.id}
        onRowClick={(row) => setOpenId(row.id)}
      />

      {visibleRows.length === 0 ? (
        <p className={styles.empty} role="status">
          No demands match these filters.
        </p>
      ) : null}

      {openId ? (
        <DemandDrawer
          id={openId}
          open
          onClose={() => setOpenId(null)}
          viewer={viewer}
        />
      ) : null}
    </section>
  );
}
