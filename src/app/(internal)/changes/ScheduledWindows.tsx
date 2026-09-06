import styles from "./changes.module.css";

/**
 * A compact, date-ordered list of the upcoming change windows — the stand-in
 * for the change calendar (`plans/plan-03-change-approvals` Task 12, spec 03
 * §8.1). Server component: pure presentation, no interaction.
 *
 * `page.tsx` passes the `SCHEDULED` changes it fetched; this component only
 * orders and formats them.
 */

export type ScheduledWindowRow = {
  ref: string;
  title: string;
  /** ISO 8601 timestamps. */
  windowStart: string | null;
  windowEnd: string | null;
};

function toMs(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** "2026-09-08 · 21:00–23:00", or just the date when the range is unusable. */
function formatWindow(start: string | null, end: string | null): string {
  if (!start) return "Window not set";
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return "Window not set";
  const day = s.toISOString().slice(0, 10);
  const from = s.toISOString().slice(11, 16);
  const e = end ? new Date(end) : null;
  const to =
    e && !Number.isNaN(e.getTime()) ? e.toISOString().slice(11, 16) : null;
  return to ? `${day} · ${from}–${to}` : `${day} · ${from}`;
}

export function ScheduledWindows({ rows }: { rows: ScheduledWindowRow[] }) {
  const ordered = [...rows].sort(
    (a, b) => toMs(a.windowStart) - toMs(b.windowStart),
  );

  return (
    <aside className={styles.windows} aria-label="Scheduled change windows">
      <h2 className={styles.windowsHead}>Scheduled windows</h2>
      {ordered.length === 0 ? (
        <p className={styles.windowsEmpty} role="status">
          No changes are scheduled.
        </p>
      ) : (
        <ul className={styles.windowsList}>
          {ordered.map((row) => (
            <li key={row.ref} className={styles.windowItem}>
              <span className={styles.windowRef}>{row.ref}</span>
              <span className={styles.windowTitle}>{row.title}</span>
              <span className={styles.windowWhen}>
                {formatWindow(row.windowStart, row.windowEnd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
