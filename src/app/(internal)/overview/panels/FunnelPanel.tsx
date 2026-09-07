import { Panel } from "@/components/Panel";
import type { OverviewResponse } from "@/lib/api/schemas/overview";
import styles from "../overview.module.css";

/** One demand-funnel stage, as `buildOverview` emits it. */
export type FunnelStage = OverviewResponse["funnel"][number];

/**
 * "Demand funnel" — a horizontal bar per pipeline stage, each bar scaled to
 * the busiest stage. The bar group is a single `role="img"` with an
 * `aria-label` summarising every stage, so a screen reader hears the whole
 * funnel in one line. Presentational — no state.
 */
export function FunnelPanel({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  const summary = stages.map((s) => `${s.count} ${s.label}`).join(", ");

  return (
    <Panel title="Demand funnel">
      {stages.length === 0 ? (
        <p className={styles.empty} role="status">
          No demands in the pipeline.
        </p>
      ) : (
        <div
          className={styles.funnel}
          role="img"
          aria-label={`Demand funnel: ${summary}`}
        >
          {stages.map((s) => (
            <div key={s.stage} className={styles.funnelRow}>
              <span className={styles.funnelLabel}>{s.label}</span>
              <span className={styles.funnelTrack} aria-hidden="true">
                <span
                  className={styles.funnelBar}
                  style={{ width: `${(s.count / max) * 100}%` }}
                />
              </span>
              <span className={styles.funnelCount}>{s.count}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
