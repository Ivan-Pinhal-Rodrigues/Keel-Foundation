"use client";

import type { MouseEvent, ReactNode } from "react";
import styles from "./DataTable.module.css";

export type Column<R> = {
  key: string;
  header: string;
  /** Optional CSS width for the column's <col> (e.g. "80px", "20%"). */
  width?: string;
  cell: (row: R) => ReactNode;
};

export type DataTableProps<R> = {
  columns: Column<R>[];
  rows: R[];
  getRowId: (row: R) => string;
  /**
   * Row activation. **Optional** — omit it for a read-only table (a dashboard
   * data display), and the rows carry no affordance at all. When set, each row
   * gets a visually-hidden activator `<button>` in its first cell.
   */
  onRowClick?: (row: R) => void;
  /**
   * Accessible name for the table (dashboards render several per page). Also
   * seeds each row activator's label — `Open <label>: <first-column text>`.
   */
  label?: string;
};

/** Interactive descendants of a row whose own click is theirs to handle — a
 *  click landing on one of these must not also fire the row's `onRowClick`. */
const INTERACTIVE_IN_CELL = "a,button,input,select,textarea,label";

/** `Open <label>: <first cell>` when the first cell renders plain text, else
 *  `Open <label>` — a generic but honest fallback. */
function rowActivatorLabel(
  firstCell: ReactNode,
  label: string | undefined,
): string {
  const base = label ?? "row";
  return typeof firstCell === "string" || typeof firstCell === "number"
    ? `Open ${base}: ${firstCell}`
    : `Open ${base}`;
}

/**
 * Generic scrollable table. Client component.
 *
 * `onRowClick` is optional. Pass it and each row is activatable: keyboard users
 * Tab to a visually-hidden `<button>` in the row's first cell and press Enter /
 * Space; mouse users click anywhere on the row (a guarded `onClick` on the
 * `<tr>` that ignores clicks landing on an interactive cell control, so an
 * actions column needs no `stopPropagation`). Omit `onRowClick` and the table
 * is inert — a pure data display. Either way the `<tr>` keeps its native
 * `role="row"` (a `<tr role="button">` around `<td>` gridcells is invalid ARIA).
 *
 * All cell content comes from `column.cell`; this component owns only the
 * frame, header, and row affordance.
 */
export function DataTable<R>({
  columns,
  rows,
  onRowClick,
  getRowId,
  label,
}: DataTableProps<R>) {
  return (
    <div className={styles.tableWrap}>
      <div className={styles.tableScroll}>
        <table className={styles.table} aria-label={label}>
          <colgroup>
            {columns.map((col) => (
              <col
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} scope="col" className={styles.th}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const onRowMouseActivate = onRowClick
                ? (event: MouseEvent<HTMLTableRowElement>) => {
                    if (
                      (event.target as HTMLElement).closest(INTERACTIVE_IN_CELL)
                    ) {
                      return;
                    }
                    onRowClick(row);
                  }
                : undefined;
              return (
                <tr
                  key={getRowId(row)}
                  className={styles.tr}
                  onClick={onRowMouseActivate}
                >
                  {columns.map((col, colIndex) => {
                    const content = col.cell(row);
                    const activatorLabel =
                      colIndex === 0 && onRowClick
                        ? rowActivatorLabel(content, label)
                        : null;
                    return (
                      <td key={col.key} className={styles.td}>
                        {activatorLabel !== null && onRowClick ? (
                          <button
                            type="button"
                            className={styles.rowActivator}
                            aria-label={activatorLabel}
                            onClick={() => onRowClick(row)}
                          >
                            {activatorLabel}
                          </button>
                        ) : null}
                        {content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
