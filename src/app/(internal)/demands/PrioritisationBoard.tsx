"use client";

import { Fragment, useMemo, useState } from "react";
import { DemandDrawer, type DemandViewer } from "./DemandDrawer";
import type { DemandWorth } from "./DemandRegister";
import { ViewToggle } from "./ViewToggle";
import styles from "./PrioritisationBoard.module.css";

/**
 * The prioritisation board — a read-only value×effort grid
 * (`plans/plan-01-demand.md` Task 8, `/demands?view=board`).
 *
 * Three effort columns (S / M / L) × three value bands (high ≥ 7, medium 4–6,
 * low ≤ 3). Each demand with both an effort and a value score sits in one
 * `(effort, band)` cell; anything not fully scored drops into the "Not yet
 * scored" tray. It is a ranking aid only — every write still happens in the
 * drawer, which a card opens (its own mount, same `<DemandDrawer>` the register
 * uses — `openId` is NOT lifted to `page.tsx`).
 *
 * `viewer` is threaded from `page.tsx` (`whoami()` in an RSC) exactly like the
 * register, and passed straight through to the drawer. It is optional so the
 * board can be rendered bare in a unit test that never opens a card.
 */

export type BoardRow = {
  id: string;
  ref: string;
  title: string;
  status: string;
  worth?: DemandWorth | null;
};

type Band = "high" | "medium" | "low";

const EFFORTS = ["S", "M", "L"] as const;
type Effort = (typeof EFFORTS)[number];

const EFFORT_NOTES: Record<Effort, string> = {
  S: "Small",
  M: "Medium",
  L: "Large",
};

const BANDS: readonly Band[] = ["high", "medium", "low"];

const BAND_LABELS: Record<Band, string> = {
  high: "High value",
  medium: "Medium value",
  low: "Low value",
};

function bandFor(score: number): Band {
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function isEffort(value: string | null | undefined): value is Effort {
  return value === "S" || value === "M" || value === "L";
}

type Placed = { cells: Record<string, BoardRow[]>; unscored: BoardRow[] };

function placeRows(rows: BoardRow[]): Placed {
  const cells: Record<string, BoardRow[]> = {};
  for (const effort of EFFORTS) {
    for (const band of BANDS) cells[`${effort}-${band}`] = [];
  }
  const unscored: BoardRow[] = [];

  for (const row of rows) {
    const effort = row.worth?.effort;
    const score = row.worth?.valueScore;
    if (!isEffort(effort) || score == null) {
      unscored.push(row);
      continue;
    }
    cells[`${effort}-${bandFor(score)}`]!.push(row);
  }

  return { cells, unscored };
}

function Card({
  row,
  onOpen,
}: {
  row: BoardRow;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => onOpen(row.id)}
    >
      <span className={styles.cardRef}>{row.ref}</span>
      <span className={styles.cardTitle}>{row.title}</span>
    </button>
  );
}

export function PrioritisationBoard({
  rows,
  viewer,
  filters,
}: {
  rows: BoardRow[];
  viewer?: DemandViewer;
  filters?: { status?: string; source?: string; mine?: boolean };
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { cells, unscored } = useMemo(() => placeRows(rows), [rows]);

  const drawerViewer: DemandViewer = viewer ?? {
    id: "",
    kind: "INTERNAL",
    hats: [],
  };

  return (
    <section className={styles.board} aria-label="Prioritisation board">
      <div className={styles.toolbar}>
        <p className={styles.caption}>
          Ranking aid. Decisions happen in the drawer.
        </p>
        <ViewToggle active="board" params={filters ?? {}} />
      </div>

      <div className={styles.gridScroll}>
        <div className={styles.grid}>
          <div className={styles.corner} aria-hidden="true" />
          {EFFORTS.map((effort) => (
            <div key={effort} className={styles.colHead}>
              <span className={styles.colHeadKey}>{effort}</span>
              <span className={styles.colHeadNote}>{EFFORT_NOTES[effort]}</span>
            </div>
          ))}

          {BANDS.map((band) => (
            <Fragment key={band}>
              <div className={styles.rowHead}>{BAND_LABELS[band]}</div>
              {EFFORTS.map((effort) => {
                const key = `${effort}-${band}`;
                const cards = cells[key] ?? [];
                return (
                  <div
                    key={key}
                    className={styles.cell}
                    data-testid={`cell-${key}`}
                  >
                    {cards.map((row) => (
                      <Card key={row.id} row={row} onOpen={setOpenId} />
                    ))}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <div className={styles.tray} data-testid="tray-unscored">
        <h3 className={styles.trayHead}>Not yet scored</h3>
        {unscored.length > 0 ? (
          <div className={styles.trayCards}>
            {unscored.map((row) => (
              <Card key={row.id} row={row} onOpen={setOpenId} />
            ))}
          </div>
        ) : (
          <p className={styles.trayEmpty}>Every demand has been scored.</p>
        )}
      </div>

      {openId ? (
        <DemandDrawer
          id={openId}
          open
          onClose={() => setOpenId(null)}
          viewer={drawerViewer}
        />
      ) : null}
    </section>
  );
}
