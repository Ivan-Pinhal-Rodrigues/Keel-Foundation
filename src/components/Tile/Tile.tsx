import type { ReactNode } from "react";
import styles from "./Tile.module.css";

export type TileTone = "ok" | "warn" | "crit" | "info";

export type TileProps = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: TileTone;
};

/**
 * Single metric tile — label, a big value, and an optional sub line with a
 * tone-coloured tick. Pure presentational wrapper (server component).
 *
 * A trailing unit is the caller's responsibility: pass it inside `value` as
 * `<>41<small>m</small></>` and `.big small` styles it.
 */
export function Tile({ label, value, sub, tone }: TileProps) {
  return (
    <div className={styles.tile}>
      <span className={styles.lab}>{label}</span>
      <span className={styles.big}>{value}</span>
      {sub != null ? (
        <span className={styles.sub}>
          {tone ? <span className={styles.tick} data-tone={tone} /> : null}
          {sub}
        </span>
      ) : null}
    </div>
  );
}
