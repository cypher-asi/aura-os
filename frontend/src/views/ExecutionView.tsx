import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { useEventContext } from "../context/EventContext";
import { AgentStatusBar } from "./AgentStatusBar";
import { TaskFeed } from "./TaskFeed";
import { LogPanel } from "./LogPanel";
import { LoopControls } from "./LoopControls";
import styles from "./execution.module.css";

export function ExecutionView() {
  const { projectId } = useParams<{ projectId: string }>();
  const { connected, subscribe } = useEventContext();
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopPaused, setLoopPaused] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubs = [
      subscribe("loop_started", () => {
        setLoopRunning(true);
        setLoopPaused(false);
      }),
      subscribe("loop_paused", () => {
        setLoopPaused(true);
      }),
      subscribe("loop_stopped", () => {
        setLoopRunning(false);
        setLoopPaused(false);
      }),
      subscribe("loop_finished", () => {
        setLoopRunning(false);
        setLoopPaused(false);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe]);

  if (!projectId) return null;

  const handleStart = async () => {
    setError("");
    try {
      await api.startLoop(projectId);
      setLoopRunning(true);
      setLoopPaused(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start loop");
    }
  };

  const handlePause = async () => {
    try {
      await api.pauseLoop(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause loop");
    }
  };

  const handleStop = async () => {
    try {
      await api.stopLoop(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop loop");
    }
  };

  return (
    <div className={styles.executionView}>
      {!connected && (
        <div className={styles.fallbackBanner}>
          Live updates unavailable — polling for status
        </div>
      )}

      <AgentStatusBar projectId={projectId} />

      <div className={styles.panels}>
        <TaskFeed projectId={projectId} />
        <LogPanel />
      </div>

      <LoopControls
        projectId={projectId}
        running={loopRunning}
        paused={loopPaused}
        onStart={handleStart}
        onPause={handlePause}
        onStop={handleStop}
      />

      {error && (
        <div
          style={{
            color: "var(--color-danger)",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
