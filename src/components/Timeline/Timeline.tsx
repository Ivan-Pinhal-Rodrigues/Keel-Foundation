import type { ReactNode } from "react";
import styles from "./Timeline.module.css";

export type TimelineItem = {
  time: string;
  text: ReactNode;
};

export type TimelineProps = {
  items: TimelineItem[];
};

/**
 * Time-stamped event list with a left connector rail. Pure presentational
 * wrapper (server component).
 */
export function Timeline({ items }: TimelineProps) {
  return (
    <ul className={styles.tl}>
      {items.map((item, index) => (
        // TimelineItem has no id; the list is static and presentational, so the
        // array index is an acceptable key here.
        <li key={index}>
          <span className={styles.tlDot} />
          <span className={styles.tlTime}>{item.time}</span>
          <span className={styles.tlTxt}>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}
