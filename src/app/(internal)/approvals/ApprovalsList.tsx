import { Pill } from "@/components/Pill";
import styles from "./approvals.module.css";

/**
 * One pending approval waiting on the current actor — the shape
 * `listApprovalsForActor` (spec 04 §7) already returns, one row per pending
 * request whose current step's hat the actor holds.
 */
export type ApprovalItem = {
  subjectType: string;
  subjectId: string;
  subjectRef: string;
  subjectTitle: string;
  policyKey: string;
  currentRequiredHat: string;
  needsOverride: boolean;
};

/**
 * "Approvals waiting on me" (spec 04 §7) — a flat list of deep links into the
 * change register. Server component: every row is a plain `<a>`, no
 * interaction. Each item is already one pending request for one change, so a
 * flat list needs no grouping. The `?open=<subjectId>` query is read by the
 * change register (Task 12) to auto-open that change's drawer.
 */
export function ApprovalsList({ items }: { items: ApprovalItem[] }) {
  if (items.length === 0) {
    return (
      <section className={styles.wrap} aria-label="Approvals waiting on you">
        <p className={styles.empty} role="status">
          Nothing is waiting on you.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.wrap} aria-label="Approvals waiting on you">
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={`${item.subjectType}:${item.subjectId}`}>
            <a className={styles.row} href={`/changes?open=${item.subjectId}`}>
              <span className={styles.ref}>{item.subjectRef}</span>
              <span className={styles.title}>{item.subjectTitle}</span>
              <span className={styles.tags}>
                {item.needsOverride ? (
                  <Pill tone="warn" dot>
                    Needs your override — you submitted this
                  </Pill>
                ) : null}
                <Pill tone="accent">{item.currentRequiredHat}</Pill>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
