"use client";

import { useState } from "react";
import { PortalDemandForm } from "./PortalDemandForm";
import { PortalIncidentForm } from "./PortalIncidentForm";
import styles from "./submit.module.css";

/**
 * The unified `/portal/submit` tab strip (plan-04 Task 11). Two tabs: one to
 * request software or a feature (a demand), one to report a problem with
 * delivered software (an incident). Client component — it holds the active-tab
 * `useState` and the WAI-ARIA tabs wiring (`role="tablist"` / `role="tab"` /
 * `role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`).
 */

type TabId = "demand" | "incident";

export function SubmitTabs() {
  const [active, setActive] = useState<TabId>("demand");

  return (
    <>
      <div
        className={styles.tablist}
        role="tablist"
        aria-label="What to submit"
      >
        <button
          type="button"
          role="tab"
          id="submit-tab-demand"
          aria-selected={active === "demand"}
          aria-controls="submit-panel-demand"
          tabIndex={active === "demand" ? 0 : -1}
          className={styles.tab}
          onClick={() => setActive("demand")}
        >
          Request software or a feature
        </button>
        <button
          type="button"
          role="tab"
          id="submit-tab-incident"
          aria-selected={active === "incident"}
          aria-controls="submit-panel-incident"
          tabIndex={active === "incident" ? 0 : -1}
          className={styles.tab}
          onClick={() => setActive("incident")}
        >
          Report a problem with delivered software
        </button>
      </div>

      {active === "demand" ? (
        <div
          role="tabpanel"
          id="submit-panel-demand"
          aria-labelledby="submit-tab-demand"
          className={styles.panel}
        >
          <p className={styles.panelIntro}>
            Ask us to build something new or change how a product works. We will
            review it and keep you posted here.
          </p>
          <PortalDemandForm />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="submit-panel-incident"
          aria-labelledby="submit-tab-incident"
          className={styles.panel}
        >
          <p className={styles.panelIntro}>
            Tell us what is not working in software we have delivered. We will
            look into it and keep you posted here.
          </p>
          <PortalIncidentForm />
        </div>
      )}
    </>
  );
}
