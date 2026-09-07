import { Panel } from "@/components/Panel";
import type { OverviewResponse } from "@/lib/api/schemas/overview";
import styles from "../overview.module.css";

/** One scheduled change window, as `buildOverview` emits it. */
export type ScheduledWindow = OverviewResponse["windows"][number];

/**
 * "Scheduled windows" — the approved changes with an implementation window in
 * the next 14 days, earliest first. Each row shows the ref, the title and the
 * window as `YYYY-MM-DD HH:MM → HH:MM` (UTC). Presentational — no state.
 */
export function WindowsPanel({ windows }: { windows: ScheduledWindow[] }) {
  const ordered = [...windows].sort((a, b) =>
    a.windowStart.localeCompare(b.windowStart),
  );

  return (
    <Panel
      title="Scheduled windows"
      count={ordered.length > 0 ? ordered.length : undefined}
    >
      {ordered.length === 0 ? (
        <p className={styles.empty} role="status">
          No changes scheduled in the next 14 days.
        </p>
      ) : (
        <ul className={styles.list}>
          {ordered.map((w) => (
            <li key={w.id}>
              <div className={styles.row}>
                <span className={styles.ref}>{w.ref}</span>
                <span className={styles.title}>{w.title}</span>
                <span className={styles.hint}>
                  {fmtStart(w.windowStart)} &rarr; {fmtTime(w.windowEnd)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** `2026-09-08 22:00` — ISO date + time, minute precision, UTC. */
function fmtStart(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

/** `04:00` — just the UTC time, minute precision. */
function fmtTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}
