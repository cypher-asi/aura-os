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
  projectId: _projectId,
  running,
  paused,
  onStart,
  onPause,
  onStop,
}: LoopControlsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleStopConfirm = () => {
    setConfirmOpen(false);
    onStop();
  };

  return (
    <>
      <div className={styles.controlRow}>
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
