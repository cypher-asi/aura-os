import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { useEventStore } from "../stores/event-store";
import { AgentStatusBar } from "./AgentStatusBar";
import { TaskFeed } from "./TaskFeed";
import { LogPanel } from "./LogPanel";
import { LoopControls } from "./LoopControls";
import { Badge, Text } from "@cypher-asi/zui";
import styles from "./aura.module.css";

export function ExecutionView() {
  const { projectId } = useParams<{ projectId: string }>();
  const connected = useEventStore((s) => s.connected);
  const subscribe = useEventStore((s) => s.subscribe);
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
        <Badge variant="error">Live updates unavailable — polling for status</Badge>
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
        <Text variant="muted" size="sm" align="center" style={{ color: "var(--color-danger)" }}>
          {error}
        </Text>
      )}
    </div>
  );
}
