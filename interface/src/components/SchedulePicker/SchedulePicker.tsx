import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Clock } from "lucide-react";
import styles from "./SchedulePicker.module.css";

// ── Types ──

type Frequency = "manual" | "daily" | "weekly" | "monthly";

interface ScheduleState {
  freq: Frequency;
  hour: number;
  minute: number;
  weekdays: number[]; // 0=Sun, 1=Mon … 6=Sat
  dayOfMonth: number;
}

export interface SchedulePickerProps {
  value: string;
  onChange: (cron: string) => void;
  disabled?: boolean;
}

// ── Cron helpers ──

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DEFAULT_STATE: ScheduleState = {
  freq: "manual",
  hour: 9,
  minute: 0,
  weekdays: [1], // Monday
  dayOfMonth: 1,
};

function scheduleToCron(s: ScheduleState): string {
  if (s.freq === "manual") return "";
  const min = String(s.minute);
  const hr = String(s.hour);
  if (s.freq === "daily") return `${min} ${hr} * * *`;
  if (s.freq === "weekly") {
    const days = s.weekdays.length > 0 ? s.weekdays.sort((a, b) => a - b).join(",") : "1";
    return `${min} ${hr} * * ${days}`;
  }
  // monthly
  return `${min} ${hr} ${s.dayOfMonth} * *`;
}

function cronToSchedule(cron: string): ScheduleState {
  const trimmed = cron.trim();
  if (!trimmed) return { ...DEFAULT_STATE };

  const parts = trimmed.split(/\s+/);
  if (parts.length < 5) return { ...DEFAULT_STATE };

  const [minP, hrP, domP, , dowP] = parts;
  const minute = parseInt(minP, 10);
  const hour = parseInt(hrP, 10);

  if (isNaN(minute) || isNaN(hour)) return { ...DEFAULT_STATE };

  // Weekly: dom is *, dow is not *
  if (domP === "*" && dowP !== "*") {
    const weekdays = dowP
      .split(",")
      .map((d) => parseInt(d, 10))
      .filter((n) => !isNaN(n) && n >= 0 && n <= 7)
      .map((n) => (n === 7 ? 0 : n)); // normalize 7 → 0 (Sun)
    return { freq: "weekly", hour, minute, weekdays, dayOfMonth: 1 };
  }

  // Monthly: dom is a number, dow is *
  if (domP !== "*" && dowP === "*") {
    const dom = parseInt(domP, 10);
    if (!isNaN(dom) && dom >= 1 && dom <= 31) {
      return { freq: "monthly", hour, minute, weekdays: [1], dayOfMonth: dom };
    }
  }

  // Daily: both dom and dow are *
  if (domP === "*" && dowP === "*") {
    return { freq: "daily", hour, minute, weekdays: [1], dayOfMonth: 1 };
  }

  return { ...DEFAULT_STATE };
}

function formatTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  const m = String(minute).padStart(2, "0");
  return `${h}:${m} ${suffix}`;
}

function describeSchedule(s: ScheduleState): string {
  if (s.freq === "manual") return "Manual only";
  const time = formatTime(s.hour, s.minute);
  if (s.freq === "daily") return `Daily at ${time}`;
  if (s.freq === "weekly") {
    const dayNames = s.weekdays
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_LABELS[d])
      .join(", ");
    return `Weekly on ${dayNames || "Mon"} at ${time}`;
  }
  const suffix =
    s.dayOfMonth === 1 || s.dayOfMonth === 21 || s.dayOfMonth === 31
      ? "st"
      : s.dayOfMonth === 2 || s.dayOfMonth === 22
        ? "nd"
        : s.dayOfMonth === 3 || s.dayOfMonth === 23
          ? "rd"
          : "th";
  return `Monthly on the ${s.dayOfMonth}${suffix} at ${time}`;
}

// ── Component ──

export function SchedulePicker({ value, onChange, disabled }: SchedulePickerProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ScheduleState>(() => cronToSchedule(value));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    setState(cronToSchedule(value));
  }, [value]);

  const reposition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const panelHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= panelHeight ? rect.bottom + 4 : rect.top - panelHeight - 4;
    setPos({ top, left: rect.left, width: Math.max(rect.width, 320) });
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const update = useCallback(
    (patch: Partial<ScheduleState>) => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        onChange(scheduleToCron(next));
        return next;
      });
    },
    [onChange],
  );

  const toggleWeekday = useCallback(
    (day: number) => {
      setState((prev) => {
        const has = prev.weekdays.includes(day);
        const next = has ? prev.weekdays.filter((d) => d !== day) : [...prev.weekdays, day];
        const weekdays = next.length > 0 ? next : [day];
        const s = { ...prev, weekdays };
        onChange(scheduleToCron(s));
        return s;
      });
    },
    [onChange],
  );

  const description = useMemo(() => describeSchedule(state), [state]);
  const cronPreview = useMemo(() => scheduleToCron(state), [state]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, i) => i), []);
  const daysOfMonth = useMemo(() => Array.from({ length: 31 }, (_, i) => i + 1), []);

  const isRecurring = state.freq !== "manual";

  const TIMEFRAME_OPTIONS: { value: Frequency; label: string }[] = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Clock size={14} className={styles.triggerIcon} />
        <span className={`${styles.triggerLabel}${!isRecurring ? ` ${styles.placeholder}` : ""}`}>
          {description}
        </span>
        <ChevronDown size={14} className={`${styles.chevron}${open ? ` ${styles.chevronOpen}` : ""}`} />
      </button>

      {open &&
        createPortal(
          <>
            <div className={styles.overlay} onClick={() => setOpen(false)} />
            {pos && (
              <div
                ref={dropdownRef}
                className={styles.dropdown}
                style={{ top: pos.top, left: pos.left, width: pos.width }}
              >
                {/* Manual vs Recurring toggle */}
                <div className={styles.modeRow}>
                  <button
                    type="button"
                    className={`${styles.modeTab}${!isRecurring ? ` ${styles.modeTabActive}` : ""}`}
                    onClick={() => update({ freq: "manual" })}
                  >
                    Manual
                  </button>
                  <button
                    type="button"
                    className={`${styles.modeTab}${isRecurring ? ` ${styles.modeTabActive}` : ""}`}
                    onClick={() => { if (!isRecurring) update({ freq: "daily" }); }}
                  >
                    Recurring
                  </button>
                </div>

                {isRecurring && (
                  <div className={styles.fields}>
                    {/* Timeframe pills */}
                    <div className={styles.pillRow}>
                      {TIMEFRAME_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`${styles.pill}${state.freq === opt.value ? ` ${styles.pillActive}` : ""}`}
                          onClick={() => update({ freq: opt.value })}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {/* Time row */}
                    <div className={styles.fieldGroup}>
                      <span className={styles.fieldLabel}>Time</span>
                      <div className={styles.timeRow}>
                        <select
                          className={styles.select}
                          value={state.hour}
                          onChange={(e) => update({ hour: parseInt(e.target.value, 10) })}
                        >
                          {hours.map((h) => (
                            <option key={h} value={h}>
                              {String(h).padStart(2, "0")}
                            </option>
                          ))}
                        </select>
                        <span className={styles.timeSep}>:</span>
                        <select
                          className={styles.select}
                          value={state.minute}
                          onChange={(e) => update({ minute: parseInt(e.target.value, 10) })}
                        >
                          {minutes.map((m) => (
                            <option key={m} value={m}>
                              {String(m).padStart(2, "0")}
                            </option>
                          ))}
                        </select>
                        <span className={styles.timeAmPm}>{state.hour >= 12 ? "PM" : "AM"}</span>
                      </div>
                    </div>

                    {/* Weekly: day toggles */}
                    {state.freq === "weekly" && (
                      <div className={styles.fieldGroup}>
                        <span className={styles.fieldLabel}>Days</span>
                        <div className={styles.dayRow}>
                          {WEEKDAY_LABELS.map((label, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className={`${styles.dayToggle}${state.weekdays.includes(idx) ? ` ${styles.dayToggleActive}` : ""}`}
                              onClick={() => toggleWeekday(idx)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Monthly: day of month */}
                    {state.freq === "monthly" && (
                      <div className={styles.fieldGroup}>
                        <span className={styles.fieldLabel}>Day of month</span>
                        <select
                          className={styles.select}
                          value={state.dayOfMonth}
                          onChange={(e) => update({ dayOfMonth: parseInt(e.target.value, 10) })}
                        >
                          {daysOfMonth.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Cron preview */}
                    <div className={styles.cronPreview}>
                      <span className={styles.cronLabel}>cron:</span>
                      <code className={styles.cronValue}>{cronPreview}</code>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>,
          document.body,
        )}
    </>
  );
}
