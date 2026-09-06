import { Timeline } from "@/components/Timeline";
import { CommentThread } from "./CommentThread";
import styles from "./portal-demands.module.css";

/**
 * One request, as the guest who raised it sees it (`plans/plan-01-demand.md`
 * Task 9). `demand` is the guest serialization from `getDemandForActor`: the
 * `DEMAND_GUEST_KEYS` allowlist, a plain-word `status`, and an `activity` list
 * already filtered to guest-safe events (internal-only audit actions are
 * dropped upstream). Server component; the message box is the one client island.
 */

type Activity = { time: string; text: string };

export function PortalDemandDetail({
  demand,
}: {
  demand: Record<string, unknown>;
}) {
  const activity = (demand.activity as Activity[] | undefined) ?? [];

  return (
    <article className={styles.detail}>
      <header className={styles.detailHead}>
        <span className={styles.cardRef}>{String(demand.ref)}</span>
        <h1 className={styles.detailTitle}>{String(demand.title)}</h1>
        <p className={styles.status}>{String(demand.status)}</p>
      </header>

      <section className={styles.section} aria-label="What you asked for">
        <h2 className={styles.sectionHead}>What you asked for</h2>
        <p className={styles.prose}>{String(demand.problem)}</p>
      </section>

      <section className={styles.section} aria-label="Progress">
        <h2 className={styles.sectionHead}>Progress</h2>
        {activity.length > 0 ? (
          <Timeline items={activity} />
        ) : (
          <p className={styles.muted}>No updates yet.</p>
        )}
      </section>

      <section className={styles.section} aria-label="Messages">
        <h2 className={styles.sectionHead}>Messages</h2>
        <CommentThread subjectPath={`/api/demands/${String(demand.id)}`} />
      </section>
    </article>
  );
}
