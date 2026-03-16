import { useMemo } from "react";
import styles from "./CommitGrid.module.css";

const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_LEVELS = [1, 4, 8, 12];

interface DaySlot {
  date: string;
  count: number;
  dayOfWeek: number;
}

interface Week {
  days: (DaySlot | null)[];
}

interface MonthSpan {
  label: string;
  weeks: number;
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
): { weeks: Week[]; months: MonthSpan[] } {
  const startDay = start.getDay();
  const offset = startDay === 0 ? 6 : startDay - 1;
  const weekStart = addDays(start, -offset);

  const weeks: Week[] = [];
  const months: MonthSpan[] = [];
  let currentMonth = -1;
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

      const month = cursor.getMonth();
      if (d === 0) {
        if (month !== currentMonth) {
          currentMonth = month;
          months.push({ label: MONTH_NAMES[month], weeks: 1 });
        } else if (months.length > 0) {
          months[months.length - 1].weeks++;
        }
      }

      cursor = addDays(cursor, 1);
    }

    weeks.push({ days: week });
  }

  return { weeks, months };
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

  const { weeks, months } = useMemo(
    () => buildWeeks(start, end, data),
    [start, end, data],
  );

  return (
    <div className={`${styles.root}${className ? ` ${className}` : ""}`}>
      <div className={styles.months}>
        {months.map((m, i) => (
          <span
            key={`${m.label}-${i}`}
            className={styles.monthLabel}
            style={{ width: m.weeks * 15 }}
          >
            {m.weeks >= 2 ? m.label : ""}
          </span>
        ))}
      </div>

      <div className={styles.body}>
        <div className={styles.dayLabels}>
          {DAY_LABELS.map((label, i) => (
            <span key={i} className={styles.dayLabel}>
              {label}
            </span>
          ))}
        </div>

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

      <div className={styles.legend}>
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={styles.legendCell}
            style={{
              background: `var(--commit-${level})`,
            }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
