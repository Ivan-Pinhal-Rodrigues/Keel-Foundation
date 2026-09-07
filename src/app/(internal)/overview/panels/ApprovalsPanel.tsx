import { Panel } from "@/components/Panel";
import { Pill } from "@/components/Pill";
import type { OverviewResponse } from "@/lib/api/schemas/overview";
import styles from "../overview.module.css";

/** One row of the "approvals waiting on me" panel, as `buildOverview` emits it. */
export type ApprovalRow = OverviewResponse["approvals"][number];

/**
 * "Approvals waiting on me" — the pending requests whose current step's hat
 * this actor holds. Each row deep-links to `/approvals`; a row the actor
 * submitted themselves shows an override badge (they cannot self-approve
 * without one). Presentational — no state of its own.
 */
export function ApprovalsPanel({ rows }: { rows: ApprovalRow[] }) {
  return (
    <Panel
      title="Approvals waiting on me"
      count={rows.length > 0 ? rows.length : undefined}
    >
      {rows.length === 0 ? (
        <p className={styles.empty} role="status">
          No approvals waiting on you.
        </p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={`${row.subjectType}:${row.subjectId}`}>
              <a className={styles.row} href={row.href}>
                <span className={styles.ref}>{row.subjectRef}</span>
                <span className={styles.title}>{row.subjectTitle}</span>
                {row.needsOverride ? (
                  <Pill tone="warn" dot>
                    you submitted this — override needed
                  </Pill>
                ) : null}
                <Pill tone="accent">{row.currentRequiredHat}</Pill>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
