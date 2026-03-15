import styles from "./TaskStatusIcon.module.css";

type VisualState = "empty" | "spinning" | "filled" | "error";

const STATUS_TO_STATE: Record<string, VisualState> = {
  pending: "empty",
  ready: "empty",
  blocked: "empty",
  planning: "empty",
  paused: "empty",
  idle: "empty",
  in_progress: "spinning",
  working: "spinning",
  active: "spinning",
  done: "filled",
  completed: "filled",
  stopped: "filled",
  archived: "filled",
  failed: "error",
  error: "error",
};

const SIZE = 14;
const STROKE = 1.5;
const R = (SIZE - STROKE) / 2;
const CENTER = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

interface TaskStatusIconProps {
  status: string;
}

export function TaskStatusIcon({ status }: TaskStatusIconProps) {
  const state = STATUS_TO_STATE[status] || "empty";

  if (state === "empty") {
    return (
      <span className={styles.icon}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle
            cx={CENTER}
            cy={CENTER}
            r={R}
            fill="none"
            stroke="var(--status-pending, #5c6078)"
            strokeWidth={STROKE}
          />
        </svg>
      </span>
    );
  }

  if (state === "spinning") {
    return (
      <span className={styles.icon}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className={styles.spin}
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r={R}
            fill="none"
            stroke="var(--status-in-progress, #9CDCFE)"
            strokeWidth={STROKE}
            strokeDasharray={`${CIRCUMFERENCE * 0.25} ${CIRCUMFERENCE * 0.75}`}
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  if (state === "error") {
    return (
      <span className={styles.icon}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle
            cx={CENTER}
            cy={CENTER}
            r={R}
            fill="var(--status-failed, #ff6b6b)"
            stroke="none"
          />
        </svg>
      </span>
    );
  }

  return (
    <span className={styles.icon}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <polyline
          points="3 7.5 6 10.5 11 4"
          fill="none"
          stroke="var(--status-done, rgb(45, 212, 191))"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
