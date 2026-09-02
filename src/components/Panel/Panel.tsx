import type { ReactNode } from "react";
import { cx } from "@/components/cx";
import styles from "./Panel.module.css";

export type PanelProps = {
  title: ReactNode;
  count?: ReactNode;
  pad?: boolean;
  children: ReactNode;
};

/**
 * Bordered card with a header (title + optional count) and a body. `pad`
 * switches the body from the tight 6px (list content) to 16px. Pure
 * presentational wrapper (server component).
 */
export function Panel({ title, count, pad, children }: PanelProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>{title}</h3>
        {count != null ? <span className={styles.count}>{count}</span> : null}
      </div>
      <div className={cx(styles.panelBody, pad && styles.pad)}>{children}</div>
    </div>
  );
}
