import type { Metadata } from "next";
import Link from "next/link";
import styles from "./demands/portal-demands.module.css";

export const metadata: Metadata = {
  title: "Portal — Keel",
};

/**
 * `/portal` — the guest landing. Minimal by design: it points at the one thing
 * built so far, the request list (`plans/plan-01-demand.md` Task 9). plan-04
 * builds the real portal home ("My requests" / "My incidents" / "Submit") and
 * the portal shell around it.
 */
export default function PortalHome() {
  return (
    <>
      <h1 className={styles.pageHead}>Your requests</h1>
      <p className={styles.lead}>
        Track the requests your team has raised with Keel and add messages to
        them.
      </p>
      <Link className={styles.homeLink} href="/portal/demands">
        View your requests
      </Link>
    </>
  );
}
