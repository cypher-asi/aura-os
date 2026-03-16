import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import styles from "./CommitGrid.module.css";

const CELL_SIZE = 7;
const GAP = 3;
const MONTH_GAP = 10;
const COL_WIDTH = CELL_SIZE + GAP;
const DEFAULT_LEVELS = [1, 4, 8, 12];

interface DaySlot {
  date: string;
  count: number;
  dayOfWeek: number;
}

interface Week {
  days: (DaySlot | null)[];
  monthStart: boolean;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getLevel(count: number, thresholds: number[]): number {
  if (count <= 0) return 0;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (count >= thresholds[i]) return i + 1;
  }
  return 1;
}

function buildWeeks(
  start: Date,
  end: Date,
  data: Record<string, number>,
): Week[] {
  const startDay = start.getDay();
  const offset = startDay === 0 ? 6 : startDay - 1;
  const weekStart = addDays(start, -offset);

  const weeks: Week[] = [];
  let cursor = new Date(weekStart);
  let prevMonth = -1;

  while (cursor <= end || weeks.length === 0) {
    const week: (DaySlot | null)[] = [];
    const weekMonth = cursor.getMonth();
    const monthStart = prevMonth !== -1 && weekMonth !== prevMonth;
    prevMonth = weekMonth;

    for (let d = 0; d < 7; d++) {
      const iso = toISODate(cursor);
      if (cursor < start || cursor > end) {
        week.push(null);
      } else {
        week.push({
          date: iso,
          count: data[iso] ?? 0,
          dayOfWeek: d,
        });
      }
      cursor = addDays(cursor, 1);
    }

    weeks.push({ days: week, monthStart });
  }

  return weeks;
}

function formatTooltip(date: string, count: number): string {
  const d = new Date(date + "T00:00:00");
  const label = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (count === 0) return `No commits on ${label}`;
  return `${count} commit${count === 1 ? "" : "s"} on ${label}`;
}

interface CommitGridProps {
  data: Record<string, number>;
  startDate?: Date;
  endDate?: Date;
  levels?: number[];
  className?: string;
}

export function CommitGrid({
  data,
  startDate,
  endDate,
  levels = DEFAULT_LEVELS,
  className,
}: CommitGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [maxWeeks, setMaxWeeks] = useState<number | null>(null);

  const measure = useCallback(() => {
    if (containerRef.current) {
      const width = containerRef.current.clientWidth;
      const approxMonthGaps = Math.floor(width / (COL_WIDTH * 4.3));
      const usable = width - approxMonthGaps * (MONTH_GAP - GAP);
      setMaxWeeks(Math.floor((usable + GAP) / COL_WIDTH));
    }
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure]);

  const end = useMemo(() => endDate ?? new Date(), [endDate]);
  const start = useMemo(() => {
    if (startDate) return startDate;
    const weeksToShow = maxWeeks ?? 52;
    const d = new Date(end);
    d.setDate(d.getDate() - weeksToShow * 7 + 1);
    return d;
  }, [startDate, end, maxWeeks]);

  const weeks = useMemo(
    () => buildWeeks(start, end, data),
    [start, end, data],
  );

  return (
    <div ref={containerRef} className={`${styles.root}${className ? ` ${className}` : ""}`}>
      {maxWeeks !== null && (
        <div className={styles.grid}>
          {weeks.map((week, wi) => (
            <div
              key={wi}
              className={styles.week}
              style={week.monthStart ? { marginLeft: MONTH_GAP - GAP } : undefined}
            >
              {week.days.map((slot, di) =>
                slot ? (
                  <div
                    key={slot.date}
                    className={styles.cell}
                    data-level={getLevel(slot.count, levels)}
                    title={formatTooltip(slot.date, slot.count)}
                  />
                ) : (
                  <div key={`empty-${wi}-${di}`} className={styles.placeholder} />
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
