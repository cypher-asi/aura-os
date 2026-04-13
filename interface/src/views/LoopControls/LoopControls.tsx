import { useState } from "react";
import type { ProjectId } from "../../types";
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
}

export function LoopControls({
  projectId,
  running,
  paused,
  onStart,
  onPause,
  onStop,
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
            dimUnselected={false}
            icon={<Play size={14} />}
            onClick={onStart}
            className={styles.startButton}
          >
            Start
          </Button>
        )}
        {paused && (
          <Button
            variant="filled"
            size="sm"
            dimUnselected={false}
            icon={<Play size={14} />}
            onClick={onStart}
            className={styles.startButton}
          >
            Resume
          </Button>
        )}
        {running && !paused && (
          <Button
            variant="secondary"
            size="sm"
            dimUnselected={false}
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
            dimUnselected={false}
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
