import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current";
import { listDemands } from "@/server/modules/demand/service";
import { PortalDemandList } from "./PortalDemandList";
import styles from "./portal-demands.module.css";

export const metadata: Metadata = {
  title: "Your requests — Keel",
};

/**
 * `/portal/demands` — the guest's own requests (`plans/plan-01-demand.md`
 * Task 9). Under the `(guest)` route group, so `(guest)/layout.tsx` has already
 * guaranteed a GUEST actor; the `!actor` guard is defensive only.
 *
 * `async` server component. `getCurrentActor()` is the RSC-safe reader
 * (`getActor()` is API-route-only) and is `React.cache`d, so re-reading it here
 * is not a second session hit. `listDemands` returns rows already scoped to the
 * guest's client and guest-serialized (plain-word `status`, no worth).
 */
export default async function PortalDemandsPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");

  const rows = await listDemands(actor, {});

  return (
    <>
      <h1 className={styles.pageHead}>Your requests</h1>
      <PortalDemandList rows={rows} />
    </>
  );
}
