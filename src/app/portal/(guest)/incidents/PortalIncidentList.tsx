import styles from "./portal-incidents.module.css";

/**
 * The guest's incident list (`plans/plan-02-incident.md` Task 10, spec 07
 * §4.3). A calm, plain-word card list — no priority, no assignee, no jargon.
 *
 * `rows` arrive ALREADY guest-serialized from `listIncidents` (the
 * `INCIDENT_GUEST_KEYS` allowlist plus `guestTransform`): `status` is the
 * plain-word phrase from `guestIncidentStatusLabel` ("Reported",
 * "Investigating", …), never an `IncidentStatus` enum, and `slaLine` is the
 * pre-rendered SLA phrase. Server component — a pure list, no interaction.
 *
 * The unread-comment dot (spec §4.3): a card whose id is in `unreadIds` (a
 * `COMMENTED` notification, computed in `page.tsx`) gets a small positional dot
 * — no message content, just the aria-labelled marker.
 */

type Row = Record<string, unknown>;

export function PortalIncidentList({
  rows,
  unreadIds = [],
}: {
  rows: Row[];
  /**
   * Incident ids with an unread team message. A plain array — the `Set` is
   * built here so the prop stays serialisable if this list ever becomes a
   * client component.
   */
  unreadIds?: string[];
}) {
  if (rows.length === 0) {
    return <p className={styles.empty}>You have no incidents yet.</p>;
  }

  const unread = new Set(unreadIds);

  return (
    <ul className={styles.list}>
      {rows.map((row) => {
        const id = String(row.id);
        return (
          <li key={id}>
            <a className={styles.card} href={`/portal/incidents/${id}`}>
              {unread.has(id) && (
                <span className={styles.dot} aria-label="unread messages" />
              )}
              <span className={styles.cardRef}>{String(row.ref)}</span>
              <span className={styles.cardTitle}>{String(row.title)}</span>
              <span className={styles.cardMeta}>
                <span className={styles.status}>{String(row.status)}</span>
                <span className={styles.affected}>
                  {String(row.affectedService)}
                </span>
              </span>
              <span className={styles.sla}>{String(row.slaLine)}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
