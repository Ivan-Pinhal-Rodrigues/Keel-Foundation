import { cx } from "@/components/cx";
import styles from "./LifecyclePips.module.css";

export type LifecyclePipsProps = {
  stages: string[];
  currentIndex: number;
  parkedIndex?: number;
};

/**
 * Row of tiny dots showing lifecycle progress: filled for done stages, ringed
 * for the current one, `--info` for a parked stage. Decorative — pair it with a
 * text status pill for the accessible label, as the prototype does. Pure
 * presentational wrapper (server component).
 */
export function LifecyclePips({
  stages,
  currentIndex,
  parkedIndex,
}: LifecyclePipsProps) {
  return (
    <div className={styles.pips}>
      {stages.map((stage, i) => {
        const state =
          parkedIndex != null && i === parkedIndex
            ? styles.parked
            : i < currentIndex
              ? styles.past
              : i === currentIndex
                ? styles.now
                : undefined;
        return <span key={stage} className={cx(styles.pip, state)} />;
      })}
    </div>
  );
}
