import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { PortalIncidentForm } from "../PortalIncidentForm";
import styles from "../portal-incidents.module.css";

export const metadata: Metadata = {
  title: "Report a problem — Keel",
};

/**
 * `/portal/incidents/new` — the guest's "report a problem" form
 * (`plans/plan-02-incident.md` Task 10). Thin server shell: guard, a heading,
 * the client form. Under the `(guest)` route group, so the actor is already a
 * guest; the `!actor` guard is defensive only.
 */
export default async function ReportIncidentPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");

  return (
    <>
      <h1 className={styles.pageHead}>Report a problem</h1>
      <p className={styles.lead}>
        Tell us what is not working. We will look into it and keep you posted
        here.
      </p>
      <PortalIncidentForm />
    </>
  );
}
