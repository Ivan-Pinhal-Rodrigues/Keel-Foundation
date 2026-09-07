import type { ReactNode } from "react";
import { Panel } from "@/components/Panel";
import { Pill } from "@/components/Pill";
import type { OverviewResponse } from "@/lib/api/schemas/overview";
import styles from "../overview.module.css";

/** One row of the "my queue" panel — the shape `buildOverview` already emits. */
export type QueueRow = OverviewResponse["myQueue"][number];

/**
 * "My queue" — the incidents, changes and demands that need this actor next,
 * pre-sorted by `buildOverview` (overdue first, then by due / window time).
 * Every row is a plain `<a href={row.href}>` deep link; the flagged rows carry
 * an `OVERDUE` pill. Presentational — no state of its own.
 */
export function MyQueuePanel({ rows }: { rows: QueueRow[] }) {
  return (
    <Panel title="My queue" count={rows.length > 0 ? rows.length : undefined}>
      {rows.length === 0 ? (
        <p className={styles.empty} role="status">
          Nothing needs you right now.
        </p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id}>
              <a className={styles.row} href={row.href}>
                <span className={styles.icon} aria-hidden="true">
                  {KIND_ICON[row.kind]}
                </span>
                <span className={styles.ref}>{row.ref}</span>
                <span className={styles.title}>{row.title}</span>
                <span className={styles.hint}>{row.hint}</span>
                {row.overdue ? (
                  <Pill tone="crit" dot>
                    OVERDUE
                  </Pill>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const KIND_ICON: Record<QueueRow["kind"], ReactNode> = {
  incident: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  ),
  change: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3v12" />
      <path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M15 6H9a3 3 0 0 0-3 3" />
    </svg>
  ),
  demand: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  ),
};
