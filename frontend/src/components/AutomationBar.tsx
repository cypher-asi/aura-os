import { useState, useEffect } from "react";
import { Button, Text, ModalConfirm } from "@cypher-asi/zui";
import { Play, Pause, Square } from "lucide-react";
import { api } from "../api/client";
import { useEventContext } from "../context/EventContext";
import { StatusBadge } from "./StatusBadge";
import type { ProjectId } from "../types";
import styles from "./Sidekick.module.css";

type AutomationStatus = "idle" | "starting" | "active" | "paused" | "stopped";

interface AutomationBarProps {
  projectId: ProjectId;
}

export function AutomationBar({ projectId }: AutomationBarProps) {
  const { subscribe } = useEventContext();
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  useEffect(() => {
    const unsubs = [
      subscribe("loop_started", () => {
        setRunning(true);
        setPaused(false);
        setStarting(false);
      }),
      subscribe("loop_paused", () => {
        setPaused(true);
      }),
      subscribe("loop_stopped", () => {
        setRunning(false);
        setPaused(false);
        setStarting(false);
      }),
      subscribe("loop_finished", () => {
        setRunning(false);
        setPaused(false);
        setStarting(false);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe]);

  let status: AutomationStatus = "idle";
  if (starting) status = "starting";
  else if (paused) status = "paused";
  else if (running) status = "active";

  const handleStart = async () => {
    try {
      setStarting(true);
      await api.startLoop(projectId);
      setRunning(true);
      setPaused(false);
    } catch (err) {
      setStarting(false);
      console.error("Failed to start loop", err);
    }
  };

  const handlePause = async () => {
    try {
      await api.pauseLoop(projectId);
    } catch (err) {
      console.error("Failed to pause loop", err);
    }
  };

  const handleStop = () => {
    setConfirmStop(true);
  };

  const handleStopConfirm = async () => {
    setConfirmStop(false);
    try {
      await api.stopLoop(projectId);
    } catch (err) {
      console.error("Failed to stop loop", err);
    }
  };

  const idle = !running && !paused;

  return (
    <>
      <div className={styles.automationBar}>
        <div className={styles.automationLabel}>
          <Text size="sm" style={{ fontWeight: 600 }}>Automation</Text>
          <StatusBadge status={status} />
        </div>
        <div className={styles.automationControls}>
          {(idle || paused) && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Play size={14} />}
              onClick={handleStart}
              title={paused ? "Resume" : "Start"}
            />
          )}
          {running && !paused && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Pause size={14} />}
              onClick={handlePause}
              title="Pause"
            />
          )}
          {(running || paused) && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Square size={14} />}
              onClick={handleStop}
              title="Stop"
            />
          )}
        </div>
      </div>

      <ModalConfirm
        isOpen={confirmStop}
        onClose={() => setConfirmStop(false)}
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
