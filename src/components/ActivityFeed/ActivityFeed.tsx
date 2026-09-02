import type { ReactNode } from "react";
import styles from "./ActivityFeed.module.css";

export type ActivityItem = {
  id: string;
  text: ReactNode;
  meta: string;
  /** CSS colour for the timeline dot (e.g. "var(--warn)"). */
  tone?: string;
};

export type ActivityFeedProps = {
  items: ActivityItem[];
};

/**
 * Vertical activity feed with a connector rail. Each item is a coloured dot,
 * a line of text, and a mono meta line. Pure presentational wrapper (server
 * component).
 */
export function ActivityFeed({ items }: ActivityFeedProps) {
  return (
    <ul className={styles.feed}>
      {items.map((item) => (
        <li key={item.id}>
          <span
            className={styles.fdot}
            style={{ background: item.tone ?? "var(--border-strong)" }}
          />
          <span>
            <span className={styles.ftext}>{item.text}</span>
            <span className={styles.fmeta}>{item.meta}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
