import { useState, useCallback, useEffect } from "react";
import { Button, Text } from "@cypher-asi/zui";
import styles from "./SchedulePicker.module.css";

type Frequency = "daily" | "weekly" | "monthly";

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DOW_CRON_VALUES = [1, 2, 3, 4, 5, 6, 0] as const;

interface Props {
  value: string;
  onChange: (cron: string) => void;
}

function parseCron(cron: string): {
  frequency: Frequency;
  hour: number;
  minute: number;
  dayOfWeek: number;
  dayOfMonth: number;
} {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { frequency: "daily", hour: 9, minute: 0, dayOfWeek: 1, dayOfMonth: 1 };
  }
  const [min, hour, dom, , dow] = parts;
  const h = parseInt(hour, 10) || 0;
  const m = parseInt(min, 10) || 0;

  if (dow !== "*") {
    const dowNum = parseInt(dow, 10);
    const idx = DOW_CRON_VALUES.indexOf(dowNum as (typeof DOW_CRON_VALUES)[number]);
    return { frequency: "weekly", hour: h, minute: m, dayOfWeek: idx >= 0 ? idx : 0, dayOfMonth: 1 };
  }
  if (dom !== "*") {
    return { frequency: "monthly", hour: h, minute: m, dayOfWeek: 0, dayOfMonth: parseInt(dom, 10) || 1 };
  }
  return { frequency: "daily", hour: h, minute: m, dayOfWeek: 0, dayOfMonth: 1 };
}

function buildCron(frequency: Frequency, hour: number, minute: number, dayOfWeek: number, dayOfMonth: number): string {
  switch (frequency) {
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly":
      return `${minute} ${hour} * * ${DOW_CRON_VALUES[dayOfWeek]}`;
    case "monthly":
      return `${minute} ${hour} ${dayOfMonth} * *`;
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function SchedulePicker({ value, onChange }: Props) {
  const parsed = parseCron(value);
  const [frequency, setFrequency] = useState<Frequency>(parsed.frequency);
  const [hour, setHour] = useState(parsed.hour);
  const [minute, setMinute] = useState(parsed.minute);
  const [dayOfWeek, setDayOfWeek] = useState(parsed.dayOfWeek);
  const [dayOfMonth, setDayOfMonth] = useState(parsed.dayOfMonth);

  const emit = useCallback(
    (f: Frequency, h: number, m: number, dow: number, dom: number) => {
      onChange(buildCron(f, h, m, dow, dom));
    },
    [onChange],
  );

  useEffect(() => {
    emit(frequency, hour, minute, dayOfWeek, dayOfMonth);
  }, [frequency, hour, minute, dayOfWeek, dayOfMonth, emit]);

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const [h, m] = e.target.value.split(":").map(Number);
    if (!isNaN(h) && !isNaN(m)) {
      setHour(h);
      setMinute(m);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.frequencyTabs}>
        {(["daily", "weekly", "monthly"] as Frequency[]).map((f) => (
          <Button
            key={f}
            className={styles.frequencyTabButton}
            variant={frequency === f ? "primary" : "ghost"}
            size="sm"
            onClick={() => setFrequency(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      {frequency === "weekly" && (
        <div className={styles.field}>
          <Text variant="muted" size="xs">Day of Week</Text>
          <div className={styles.dayButtons}>
            {DAYS_OF_WEEK.map((day, i) => (
              <Button
                key={day}
                variant={dayOfWeek === i ? "primary" : "ghost"}
                size="sm"
                onClick={() => setDayOfWeek(i)}
              >
                {day}
              </Button>
            ))}
          </div>
        </div>
      )}

      {frequency === "monthly" && (
        <div className={styles.field}>
          <Text variant="muted" size="xs">Day of Month</Text>
          <select
            className={styles.select}
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(parseInt(e.target.value, 10))}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.field}>
        <Text variant="muted" size="xs">Time</Text>
        <input
          type="time"
          className={styles.timeInput}
          value={`${pad(hour)}:${pad(minute)}`}
          onChange={handleTimeChange}
        />
      </div>
    </div>
  );
}
