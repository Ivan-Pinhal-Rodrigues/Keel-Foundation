import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { SubmitTabs } from "./SubmitTabs";
import styles from "./submit.module.css";

export const metadata: Metadata = {
  title: "Submit a request or problem — Keel",
};

/**
 * `/portal/submit` — the guest's unified submit page (plan-04 Task 11). Replaces
 * the standalone guest "report a problem" route: one tab requests software or a
 * feature (a demand), one reports a problem with delivered software (an incident).
 *
 * Thin server shell: guard, a heading, the client tabs. Under the `(guest)`
 * route group, so `(guest)/layout.tsx` has already guaranteed a GUEST actor;
 * the `!actor` guard is defensive only.
 */
export default async function PortalSubmitPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");

  return (
    <>
      <h1 className={styles.pageHead}>Submit a request or a problem</h1>
      <p className={styles.lead}>
        Choose whether you need something new built or something fixed.
      </p>
      <SubmitTabs />
    </>
  );
}
