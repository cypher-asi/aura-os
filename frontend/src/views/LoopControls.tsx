import type { ProjectId } from "../types";
import { useLiveProgress } from "../hooks/use-live-progress";
import styles from "./execution.module.css";

interface LoopControlsProps {
  projectId: ProjectId;
  running: boolean;
  paused: boolean;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
}

export function LoopControls({
  projectId,
  running,
  paused,
  onStart,
  onPause,
  onStop,
}: LoopControlsProps) {
  const progress = useLiveProgress(projectId);
  const pct = progress
    ? Math.round(progress.completion_percentage * 100) / 100
    : 0;

  const handleStop = () => {
    if (confirm("Stop autonomous execution? Current task will complete first.")) {
      onStop();
    }
  };

  return (
    <div className={styles.controls}>
      {!running && !paused && (
        <button className={styles.startBtn} onClick={onStart}>
          Start
        </button>
      )}
      {paused && (
        <button className={styles.startBtn} onClick={onStart}>
          Resume
        </button>
      )}
      {running && !paused && (
        <button className={styles.pauseBtn} onClick={onPause}>
          Pause
        </button>
      )}
      {(running || paused) && (
        <button className={styles.stopBtn} onClick={handleStop}>
          Stop
        </button>
      )}

      <div className={styles.progressSection}>
        <div className={styles.progressBarSmall}>
          <div
            className={styles.progressBarSmallFill}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={styles.progressPct}>{pct}%</span>
      </div>
    </div>
  );
}
