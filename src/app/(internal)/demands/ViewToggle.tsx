"use client";

import { useRouter } from "next/navigation";
import styles from "./ViewToggle.module.css";

/**
 * The list / board switch shared by `DemandRegister` and `PrioritisationBoard`
 * (`plans/plan-01-demand.md` Task 8). Each view is a separate mount, so the
 * toggle just rewrites the URL — appending `&view=board` (or clearing `?view`)
 * while preserving any active `status` / `source` / `mine` filter.
 */

export type ToggleParams = {
  status?: string;
  source?: string;
  mine?: boolean;
};

export function ViewToggle({
  active,
  params,
}: {
  active: "list" | "board";
  params: ToggleParams;
}) {
  const router = useRouter();

  function go(view: "list" | "board") {
    if (view === active) return;
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.source) qs.set("source", params.source);
    if (params.mine) qs.set("mine", "true");
    if (view === "board") qs.set("view", "board");
    const query = qs.toString();
    router.push(query ? `/demands?${query}` : "/demands");
  }

  return (
    <nav className={styles.toggle} aria-label="View">
      <button
        type="button"
        className={styles.btn}
        aria-pressed={active === "list"}
        onClick={() => go("list")}
      >
        List
      </button>
      <button
        type="button"
        className={styles.btn}
        aria-pressed={active === "board"}
        onClick={() => go("board")}
      >
        Board
      </button>
    </nav>
  );
}
