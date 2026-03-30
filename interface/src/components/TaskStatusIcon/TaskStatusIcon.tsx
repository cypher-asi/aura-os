import styles from "./TaskStatusIcon.module.css";

type VisualState = "empty" | "spinning" | "filled" | "error";

const STATUS_TO_STATE: Record<string, VisualState> = {
  backlog: "empty",
  to_do: "empty",
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
            strokeWidth={STROKE}
            className={styles.strokeSecondary}
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
            strokeWidth={STROKE}
            strokeDasharray={`${CIRCUMFERENCE * 0.25} ${CIRCUMFERENCE * 0.75}`}
            strokeLinecap="round"
            className={styles.strokeMuted}
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
            stroke="none"
            className={styles.fillFailed}
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
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={styles.strokeSecondary}
        />
      </svg>
    </span>
  );
}
