import { useMemo } from "react";
import styles from "./CommitGrid.module.css";

const DEFAULT_LEVELS = [1, 4, 8, 12];

interface DaySlot {
  date: string;
  count: number;
  dayOfWeek: number;
}

interface Week {
  days: (DaySlot | null)[];
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

  while (cursor <= end || weeks.length === 0) {
    const week: (DaySlot | null)[] = [];

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

    weeks.push({ days: week });
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
  const end = useMemo(() => endDate ?? new Date(), [endDate]);
  const start = useMemo(() => {
    if (startDate) return startDate;
    const d = new Date(end);
    d.setFullYear(d.getFullYear() - 1);
    d.setDate(d.getDate() + 1);
    return d;
  }, [startDate, end]);

  const weeks = useMemo(
    () => buildWeeks(start, end, data),
    [start, end, data],
  );

  return (
    <div className={`${styles.root}${className ? ` ${className}` : ""}`}>
      <div className={styles.grid}>
        {weeks.map((week, wi) => (
          <div key={wi} className={styles.week}>
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
    </div>
  );
}
