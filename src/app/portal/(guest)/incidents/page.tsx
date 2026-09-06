import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { listIncidents } from "@/server/modules/incident/service";
import { PortalIncidentList } from "./PortalIncidentList";
import styles from "./portal-incidents.module.css";

export const metadata: Metadata = {
  title: "Your incidents — Keel",
};

/**
 * `/portal/incidents` — the guest's own incidents (`plans/plan-02-incident.md`
 * Task 10). Under the `(guest)` route group, so `(guest)/layout.tsx` has already
 * guaranteed a GUEST actor; the `!actor` guard is defensive only.
 *
 * `listIncidents` returns rows already scoped to the guest's client and
 * guest-serialized (plain-word `status`, pre-rendered `slaLine`, no priority).
 */
export default async function PortalIncidentsPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");

  const rows = await listIncidents(actor, {});

  return (
    <>
      <h1 className={styles.pageHead}>Your incidents</h1>
      <PortalIncidentList rows={rows} />
    </>
  );
}
