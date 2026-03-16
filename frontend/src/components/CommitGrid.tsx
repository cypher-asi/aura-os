import { useMemo } from "react";
import styles from "./CommitGrid.module.css";

const DEFAULT_DAYS = 30;
const HOURS = 24;
const HOURS_PER_GROUP = 6;
const DAYS_PER_GROUP = 4;
const DEFAULT_LEVELS = [1, 4, 8, 12];

interface HourSlot {
  key: string;
  count: number;
}

interface DayRow {
  date: string;
  hours: HourSlot[];
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getLevel(count: number, thresholds: number[]): number {
  if (count <= 0) return 0;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (count >= thresholds[i]) return i + 1;
  }
  return 1;
}

function buildGrid(
  endDate: Date,
  days: number,
  data: Record<string, number>,
): DayRow[] {
  const rows: DayRow[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(endDate);
    date.setDate(date.getDate() - d);
    const dateStr = toISODate(date);
    const hours: HourSlot[] = [];
    for (let h = 0; h < HOURS; h++) {
      const key = `${dateStr}:${String(h).padStart(2, "0")}`;
      hours.push({ key, count: data[key] ?? 0 });
    }
    rows.push({ date: dateStr, hours });
  }
  return rows;
}

function formatTooltip(date: string, hour: number, count: number): string {
  const d = new Date(date + "T00:00:00");
  const label = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const hourLabel = `${String(hour).padStart(2, "0")}:00`;
  if (count === 0) return `No commits – ${label}, ${hourLabel}`;
  return `${count} commit${count === 1 ? "" : "s"} – ${label}, ${hourLabel}`;
}

function groupBy<T>(arr: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    groups.push(arr.slice(i, i + size));
  }
  return groups;
}

interface CommitGridProps {
  data: Record<string, number>;
  days?: number;
  endDate?: Date;
  levels?: number[];
  className?: string;
}

export function CommitGrid({
  data,
  days = DEFAULT_DAYS,
  endDate,
  levels = DEFAULT_LEVELS,
  className,
}: CommitGridProps) {
  const end = useMemo(() => endDate ?? new Date(), [endDate]);

  const rows = useMemo(
    () => buildGrid(end, days, data),
    [end, days, data],
  );

  const dayGroups = useMemo(() => groupBy(rows, DAYS_PER_GROUP), [rows]);

  return (
    <div className={`${styles.root}${className ? ` ${className}` : ""}`}>
      <div className={styles.grid}>
        {dayGroups.map((group, gi) => (
          <div key={gi} className={styles.dayGroup}>
            {group.map((row) => {
              const hourGroups = groupBy(row.hours, HOURS_PER_GROUP);
              return (
                <div key={row.date} className={styles.dayRow}>
                  {hourGroups.map((hg, hgi) => (
                    <div key={hgi} className={styles.hourGroup}>
                      {hg.map((slot, hi) => (
                        <div
                          key={slot.key}
                          className={styles.cell}
                          data-level={getLevel(slot.count, levels)}
                          title={formatTooltip(row.date, hgi * HOURS_PER_GROUP + hi, slot.count)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
