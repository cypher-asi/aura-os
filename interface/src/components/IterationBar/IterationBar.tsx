import { useMemo } from "react";
import type { IterationStats, IterationDot } from "../../utils/derive-activity";
import styles from "../Preview/Preview.module.css";

const MAX_DOTS = 40;

interface Props {
  stats: IterationStats;
  dots: IterationDot[];
  isActive: boolean;
}

export function IterationBar({ stats, dots, isActive }: Props) {
  const visibleDots = useMemo(() => dots.slice(0, MAX_DOTS), [dots]);
  const overflow = dots.length - MAX_DOTS;

  const parts: string[] = [];
  if (stats.reads > 0) parts.push(`${stats.reads} read${stats.reads !== 1 ? "s" : ""}`);
  if (stats.writes > 0) parts.push(`${stats.writes} write${stats.writes !== 1 ? "s" : ""}`);
  if (stats.commands > 0) parts.push(`${stats.commands} cmd${stats.commands !== 1 ? "s" : ""}`);
  if (stats.errors > 0) parts.push(`${stats.errors} err`);

  return (
    <div className={styles.iterationBar}>
      <div className={styles.iterationDots}>
        {visibleDots.map((dot, i) => {
          const isLast = i === visibleDots.length - 1 && overflow <= 0;
          return (
            <span
              key={i}
              className={`${styles.iterationDot} ${isActive && isLast ? styles.iterationDotPulse : ""}`}
              data-cat={dot.isError ? "error" : dot.category}
            />
          );
        })}
        {overflow > 0 && (
          <span className={styles.iterationOverflow}>+{overflow}</span>
        )}
      </div>
      <span className={styles.iterationSummary}>
        {stats.total} iteration{stats.total !== 1 ? "s" : ""}
        {parts.length > 0 && <> &middot; {parts.join(" · ")}</>}
      </span>
    </div>
  );
}
