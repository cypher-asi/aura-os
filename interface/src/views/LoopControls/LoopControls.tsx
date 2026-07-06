import { useState } from "react";
import type { ProjectId } from "../../shared/types";
import { Button, ModalConfirm } from "@cypher-asi/zui";
import { Play, Pause, Square } from "lucide-react";
import styles from "./LoopControls.module.css";

interface LoopControlsProps {
  projectId: ProjectId;
  running: boolean;
  paused: boolean;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  startDisabled?: boolean;
  startDisabledTitle?: string;
}

export function LoopControls({
  projectId,
  running,
  paused,
  onStart,
  onPause,
  onStop,
  startDisabled = false,
  startDisabledTitle,
}: LoopControlsProps) {
  void projectId;
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleStopConfirm = () => {
    setConfirmOpen(false);
    onStop();
  };

  return (
    <>
      <div className={styles.controlRow}>
        {!running && !paused && (
          <Button
            variant="filled"
            size="sm"
            icon={<Play size={14} />}
            onClick={onStart}
            disabled={startDisabled}
            title={startDisabled ? startDisabledTitle : "Start"}
            className={styles.startButton}
          >
            Start
          </Button>
        )}
        {paused && (
          <Button
            variant="filled"
            size="sm"
            icon={<Play size={14} />}
            onClick={onStart}
            disabled={startDisabled}
            title={startDisabled ? startDisabledTitle : "Resume"}
            className={styles.startButton}
          >
            Resume
          </Button>
        )}
        {running && !paused && (
          <Button
            variant="secondary"
            size="sm"
            icon={<Pause size={14} />}
            onClick={onPause}
            className={styles.secondaryButton}
          >
            Pause
          </Button>
        )}
        {(running || paused) && (
          <Button
            variant="danger"
            size="sm"
            icon={<Square size={14} />}
            onClick={() => setConfirmOpen(true)}
            className={styles.stopButton}
          >
            Stop
          </Button>
        )}
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
