import { useState } from "react";
import type { ProjectId } from "../types";
import { useLiveProgress } from "../hooks/use-live-progress";
import { Button, ModalConfirm } from "@cypher-asi/zui";
import { Play, Pause, Square } from "lucide-react";
import styles from "./aura.module.css";

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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleStopConfirm = () => {
    setConfirmOpen(false);
    onStop();
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        {!running && !paused && (
          <Button variant="filled" size="sm" icon={<Play size={14} />} onClick={onStart}>
            Start
          </Button>
        )}
        {paused && (
          <Button variant="filled" size="sm" icon={<Play size={14} />} onClick={onStart}>
            Resume
          </Button>
        )}
        {running && !paused && (
          <Button variant="secondary" size="sm" icon={<Pause size={14} />} onClick={onPause}>
            Pause
          </Button>
        )}
        {(running || paused) && (
          <Button variant="danger" size="sm" icon={<Square size={14} />} onClick={() => setConfirmOpen(true)}>
            Stop
          </Button>
        )}

        <div className={styles.progressSection}>
          <div className={styles.progressBarSmall}>
            <div className={styles.progressBarSmallFill} style={{ width: `${pct}%` }} />
          </div>
          <span className={styles.progressPct}>{pct}%</span>
        </div>
      </div>

      <ModalConfirm
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleStopConfirm}
        title="Stop Execution"
        message="Stop autonomous execution? The current task will complete first."
        confirmLabel="Stop"
        cancelLabel="Cancel"
        danger
      />
    </>
  );
}
