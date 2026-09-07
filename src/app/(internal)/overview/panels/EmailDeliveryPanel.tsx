import { Panel } from "@/components/Panel";
import { Pill } from "@/components/Pill";
import type { OverviewResponse } from "@/lib/api/schemas/overview";
import styles from "../overview.module.css";

/** The email-delivery health block, as `buildOverview` emits it. */
export type EmailFailures = OverviewResponse["emailFailures"];

/**
 * "Email delivery" — how many notification emails failed to send in the last
 * 7 days. Healthy (`count === 0`) is a one-line `ok` state; any failures flip
 * it `crit` and expose an expandable list of the most recent failing rows.
 * Retrying is a manual DB action in v1, so the panel only reports.
 * Presentational — no state (`<details>` is native).
 */
export function EmailDeliveryPanel({ data }: { data: EmailFailures }) {
  const failing = data.count > 0;

  return (
    <Panel title="Email delivery">
      <div className={styles.email}>
        <div className={styles.emailHead}>
          <span className={styles.emailValue}>{data.count}</span>
          <Pill tone={failing ? "crit" : "ok"} dot>
            {failing
              ? "failed in the last 7 days"
              : "all sent in the last 7 days"}
          </Pill>
        </div>

        {failing && data.recent.length > 0 ? (
          <details className={styles.emailDetails}>
            <summary>Recent failures ({data.recent.length})</summary>
            <ul className={styles.emailList}>
              {data.recent.map((r, i) => (
                <li key={`${r.toEmail}:${r.template}:${i}`}>
                  <span className={styles.emailTo}>{r.toEmail}</span>
                  <span className={styles.emailTemplate}>{r.template}</span>
                  <span className={styles.emailError}>
                    {r.lastError ?? "no error recorded"}
                  </span>
                  <span className={styles.emailAttempts}>
                    {r.attempts} attempt{r.attempts === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <p className={styles.emailNote}>Retry is a manual DB action in v1.</p>
      </div>
    </Panel>
  );
}
