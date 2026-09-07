import { ActivityFeed, type ActivityItem } from "@/components/ActivityFeed";
import { Panel } from "@/components/Panel";
import type { OverviewResponse } from "@/lib/api/schemas/overview";
import styles from "../overview.module.css";

/** One activity entry, as `buildOverview` emits it. */
export type ActivityEntry = OverviewResponse["activity"][number];

/**
 * "Recent activity" — the latest audited events across incidents, changes and
 * demands, newest first (already ordered by `buildOverview`). Each row is the
 * event text with a relative-time meta line. Presentational — no state.
 */
export function ActivityPanel({ items }: { items: ActivityEntry[] }) {
  const feed: ActivityItem[] = items.map((item, i) => ({
    id: `${item.at}:${i}`,
    text: item.text,
    meta: relativeTime(item.at),
  }));

  return (
    <Panel title="Recent activity">
      {feed.length === 0 ? (
        <p className={styles.empty} role="status">
          Nothing has happened recently.
        </p>
      ) : (
        <ActivityFeed items={feed} />
      )}
    </Panel>
  );
}

/**
 * Compact relative time ("just now", "5m ago", "3h ago", "2d ago"), falling
 * back to an ISO date past 30 days. Mirrors the private helper the
 * `NotificationBell` uses — kept local because that one is not exported.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
