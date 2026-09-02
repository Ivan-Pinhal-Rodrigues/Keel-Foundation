"use client";

import type { KeyboardEvent, ReactNode } from "react";
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
  onRowClick: (row: R) => void;
  getRowId: (row: R) => string;
  /** Accessible name for the table (dashboards render several per page). */
  label?: string;
};

/**
 * Generic scrollable table. Client component — rows carry an `onRowClick`
 * handler and are keyboard-activatable (`role="button"` + Enter / Space).
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
              const activate = () => onRowClick(row);
              const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  activate();
                }
              };
              return (
                <tr
                  key={getRowId(row)}
                  className={styles.tr}
                  role="button"
                  tabIndex={0}
                  onClick={activate}
                  onKeyDown={onKeyDown}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={styles.td}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
