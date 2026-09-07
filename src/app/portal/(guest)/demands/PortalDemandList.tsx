import styles from "./portal-demands.module.css";

/**
 * The guest's request list (`plans/plan-01-demand.md` Task 9). A calm, plain-word
 * card list — no internal density, no jargon, no worth/effort columns.
 *
 * `rows` arrive ALREADY guest-serialized from `listDemands` (the
 * `DEMAND_GUEST_KEYS` allowlist plus `guestTransform`): `status` is the
 * plain-word phrase from `guestStatusLabel` ("In review", "Approved", …), never
 * a `DemandStatus` enum. Server component — a pure list, no interaction.
 */

type Row = Record<string, unknown>;

function isoDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function PortalDemandList({
  rows,
  unreadIds = [],
}: {
  rows: Row[];
  /**
   * Demand ids with an unread team message (a `COMMENTED` notification, from
   * `page.tsx`). A plain array — the `Set` is built here so the prop stays
   * serialisable if this list ever becomes a client component.
   */
  unreadIds?: string[];
}) {
  if (rows.length === 0) {
    return <p className={styles.empty}>You have no requests yet.</p>;
  }

  const unread = new Set(unreadIds);

  return (
    <ul className={styles.list}>
      {rows.map((row) => {
        const id = String(row.id);
        return (
          <li key={id}>
            <a className={styles.card} href={`/portal/demands/${id}`}>
              {unread.has(id) && (
                <span className={styles.dot} aria-label="unread messages" />
              )}
              <span className={styles.cardRef}>{String(row.ref)}</span>
              <span className={styles.cardTitle}>{String(row.title)}</span>
              <span className={styles.cardMeta}>
                <span className={styles.status}>{String(row.status)}</span>
                <span className={styles.date}>{isoDate(row.createdAt)}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
