import type { ReactNode } from "react";
import { cx } from "@/components/cx";
import styles from "./Pill.module.css";

export type PillTone = "ok" | "warn" | "crit" | "info" | "accent";

export type PillProps = {
  tone: PillTone;
  dot?: boolean;
  children: ReactNode;
};

/** Status chip. `dot` prepends a small filled circle. Server component. */
export function Pill({ tone, dot, children }: PillProps) {
  return (
    <span className={cx(styles.pill, styles[tone])}>
      {dot ? <span className={styles.pdot} /> : null}
      {children}
    </span>
  );
}

export type Priority = "P1" | "P2" | "P3" | "P4";

export type PriorityTagProps = { priority: Priority };

/** Priority badge — text is the priority string itself. Server component. */
export function PriorityTag({ priority }: PriorityTagProps) {
  return (
    <span className={cx(styles.pri, styles[priority.toLowerCase()])}>
      {priority}
    </span>
  );
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type RiskLabelProps = { level: RiskLevel };

/** Risk label with a leading bullet (from CSS). Server component. */
export function RiskLabel({ level }: RiskLabelProps) {
  return (
    <span className={cx(styles.risk, styles[level.toLowerCase()])}>
      {level}
    </span>
  );
}

export type Env = "dev" | "test" | "staging" | "prod";

export type EnvTagProps = { env: Env };

/** Environment tag — CSS uppercases the text. Server component. */
export function EnvTag({ env }: EnvTagProps) {
  return <span className={cx(styles.env, styles[env])}>{env}</span>;
}
