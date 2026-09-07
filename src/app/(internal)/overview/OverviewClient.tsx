"use client";

import { useEffect, useState } from "react";
import { Tile } from "@/components/Tile";
import { apiFetch } from "@/lib/api/client";
import type { OverviewResponse } from "@/lib/api/schemas/overview";
import { ActivityPanel } from "./panels/ActivityPanel";
import { ApprovalsPanel } from "./panels/ApprovalsPanel";
import { EmailDeliveryPanel } from "./panels/EmailDeliveryPanel";
import { FunnelPanel } from "./panels/FunnelPanel";
import { MyQueuePanel } from "./panels/MyQueuePanel";
import { WindowsPanel } from "./panels/WindowsPanel";
import styles from "./overview.module.css";

/**
 * The `/overview` dashboard body — a `"use client"` island (spec 06 §5,
 * ruling 9). Seeded from the server-rendered `initial` payload, it re-fetches
 * `GET /api/overview` on window `focus` and every 60s, keeping the last-good
 * payload on any transient failure. Both listeners are torn down on unmount.
 *
 * It renders the tile row plus the six-panel grid: `<MyQueuePanel>`,
 * `<ApprovalsPanel>`, `<ActivityPanel>`, `<FunnelPanel>`, `<WindowsPanel>` and
 * `<EmailDeliveryPanel>`, each fed from the current payload.
 */
export function OverviewClient({ initial }: { initial: OverviewResponse }) {
  const [data, setData] = useState<OverviewResponse>(initial);

  useEffect(() => {
    let alive = true;

    const refetch = async () => {
      try {
        const next = await apiFetch<OverviewResponse>("/api/overview");
        if (alive && next) setData(next);
      } catch {
        // Keep the last-good payload — a blip should not blank the dashboard.
      }
    };

    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void refetch(), 60_000);

    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, []);

  const { tiles } = data;

  return (
    <section className={styles.wrap} aria-label="Overview">
      <div className={styles.tiles}>
        <Tile
          label="My open items"
          value={tiles.myOpenItems}
          sub="Incidents and changes you own"
        />
        <Tile
          label="Approvals waiting"
          value={tiles.approvalsWaiting}
          tone={tiles.approvalsWaiting > 0 ? "warn" : "ok"}
          sub={
            tiles.approvalsWaiting > 0
              ? "Waiting on your decision"
              : "Nothing waiting on you"
          }
        />
        <Tile
          label="Overdue"
          value={tiles.overdue}
          tone={tiles.overdue > 0 ? "crit" : "ok"}
          sub={tiles.overdue > 0 ? "Past SLA" : "All within SLA"}
        />
        <Tile
          label="Demands in triage"
          value={tiles.demandsInTriage}
          sub="Awaiting assessment"
        />
      </div>

      <div className={styles.grid}>
        <MyQueuePanel rows={data.myQueue} />
        <ApprovalsPanel rows={data.approvals} />

        <ActivityPanel items={data.activity} />
        <FunnelPanel stages={data.funnel} />
        <WindowsPanel windows={data.windows} />
        <EmailDeliveryPanel data={data.emailFailures} />
      </div>
    </section>
  );
}
