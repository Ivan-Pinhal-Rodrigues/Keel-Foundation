import { Timeline } from "@/components/Timeline";
import { CommentThread } from "../demands/CommentThread";
import styles from "./portal-incidents.module.css";

/**
 * One incident, as the guest who raised it sees it (`plans/plan-02-incident.md`
 * Task 10, spec 07 §4.5). `incident` is the guest serialization from
 * `getIncidentForActor`: the `INCIDENT_GUEST_KEYS` allowlist, a plain-word
 * `status`, a pre-rendered `slaLine`, a `fix` signal, and an `activity` list
 * already filtered to guest-safe events. It carries NO impact / priority /
 * assignee / raw enum — this component must not reference any internal field.
 *
 * Server component; the message box is the one client island. It reuses the
 * demand portal's `CommentThread` with `subjectPath` pointed at the incident
 * comments endpoint.
 */

type Activity = { time: string; text: string };

/** A plain-language "where it is" line derived from the guest status word. */
function whereLine(status: string): string {
  switch (status) {
    case "Reported":
      return "We have received this and will start looking into it.";
    case "Investigating":
      return "Someone is looking into this now.";
    case "Resolved":
      return "This has been put right.";
    case "Closed":
      return "This is now closed.";
    default:
      return status;
  }
}

/** The fix line, or `null` when there is nothing to say. */
function fixLine(fix: unknown): string | null {
  if (fix === "on_the_way") return "A fix is on the way";
  if (fix === "fixed") return "This has been fixed";
  return null;
}

export function PortalIncidentDetail({
  incident,
}: {
  incident: Record<string, unknown>;
}) {
  const activity = (incident.activity as Activity[] | undefined) ?? [];
  const status = String(incident.status);
  const fix = fixLine(incident.fix);

  return (
    <article className={styles.detail}>
      <header className={styles.detailHead}>
        <span className={styles.cardRef}>{String(incident.ref)}</span>
        <h1 className={styles.detailTitle}>{String(incident.title)}</h1>
        <p className={styles.status}>{status}</p>
      </header>

      <section className={styles.section} aria-label="Where it is">
        <h2 className={styles.sectionHead}>Where it is</h2>
        <p className={styles.prose}>{whereLine(status)}</p>
        <p className={styles.sla}>{String(incident.slaLine)}</p>
        {fix ? <p className={styles.fix}>{fix}</p> : null}
      </section>

      {activity.length > 0 ? (
        <section className={styles.section} aria-label="Progress">
          <h2 className={styles.sectionHead}>Progress</h2>
          <Timeline items={activity} />
        </section>
      ) : null}

      <section className={styles.section} aria-label="Details you gave">
        <h2 className={styles.sectionHead}>Details you gave</h2>
        <p className={styles.prose}>{String(incident.title)}</p>
        <p className={styles.prose}>{String(incident.description)}</p>
      </section>

      <section className={styles.section} aria-label="Conversation">
        <h2 className={styles.sectionHead}>Conversation</h2>
        <CommentThread subjectPath={`/api/incidents/${String(incident.id)}`} />
      </section>
    </article>
  );
}
