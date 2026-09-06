import { Pill, PriorityTag, type Priority } from "@/components/Pill";
import { cx } from "@/components/cx";
import styles from "./incidents.module.css";

/**
 * One incident, rendered as a card (spec §9.1 — the internal register is a card
 * list, not a `DataTable`). The whole card is a `<button>` so a click opens the
 * drawer; `IncidentRegister` owns the `openId` state.
 */

export type IncidentRow = {
  id: string;
  ref: string;
  title: string;
  affectedService: string;
  priority: Priority;
  status: string;
  /** Internal serialization only — used by the "Mine" filter. */
  assigneeId: string | null;
  assigneeName: string | null;
  /** ISO 8601. */
  dueAt: string;
  /** Freshly derived by `serializeIncident` for internal readers. */
  overdue: boolean;
  /** ISO 8601. */
  createdAt: string;
};

function toMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Compact elapsed time since `iso` — "just now", "5m", "3h", "2d", "4mo". */
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

/** Time remaining until `iso` — "due in 3h", "due in 2d", "due now". */
function dueLabel(iso: string): string {
  const due = toMs(iso);
  if (due === 0) return "no SLA";
  const secs = Math.round((due - Date.now()) / 1000);
  if (secs <= 0) return "due now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `due in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `due in ${hours}h`;
  return `due in ${Math.round(hours / 24)}d`;
}

/** Severity rail colour — `--crit` for P1/P2, `--warn` for P3, muted for P4. */
function railClass(priority: Priority): string | undefined {
  if (priority === "P1" || priority === "P2") return styles.railCrit;
  if (priority === "P3") return styles.railWarn;
  return styles.railMuted;
}

export function IncidentCard({
  row,
  onOpen,
}: {
  row: IncidentRow;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => onOpen(row.id)}
    >
      <span
        aria-hidden="true"
        className={cx(styles.rail, railClass(row.priority))}
      />
      <span className={styles.cardMain}>
        <span className={styles.cardTop}>
          <span className={styles.ref}>{row.ref}</span>
          <PriorityTag priority={row.priority} />
          <span className={styles.age}>{relativeAge(row.createdAt)}</span>
        </span>
        <span className={styles.title}>{row.title}</span>
        <span className={styles.meta}>
          <span className={styles.service}>{row.affectedService}</span>
          <span className={styles.dot} aria-hidden="true">
            ·
          </span>
          {row.overdue ? (
            <Pill tone="crit" dot>
              OVERDUE
            </Pill>
          ) : (
            <span className={styles.due}>{dueLabel(row.dueAt)}</span>
          )}
          <span className={styles.dot} aria-hidden="true">
            ·
          </span>
          <span className={styles.assignee}>
            {row.assigneeName ?? "Unassigned"}
          </span>
        </span>
      </span>
    </button>
  );
}
