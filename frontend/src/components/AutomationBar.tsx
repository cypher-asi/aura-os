import { useState, useEffect, useRef, useCallback } from "react";
import { Button, Text, ModalConfirm } from "@cypher-asi/zui";
import { Play, Pause, Square } from "lucide-react";
import { api } from "../api/client";
import { useEventContext } from "../context/EventContext";
import { useSidekick } from "../context/SidekickContext";
import { StatusBadge } from "./StatusBadge";
import type { ProjectId } from "../types";
import styles from "./Sidekick.module.css";

type AutomationStatus = "idle" | "starting" | "active" | "paused" | "stopped";

interface AutomationBarProps {
  projectId: ProjectId;
}

export function AutomationBar({ projectId }: AutomationBarProps) {
  const { subscribe, connected } = useEventContext();
  const { setActiveTab } = useSidekick();
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const isForProject = useCallback(
    (event: { project_id?: string }) => event.project_id === projectId,
    [projectId],
  );

  const fetchLoopStatus = useCallback(() => {
    api.getLoopStatus(projectId)
      .then((res) => {
        if (res.active_agents && res.active_agents.length > 0) {
          setActiveAgents(res.active_agents);
          setPaused(res.paused);
          setStarting(false);
        } else {
          setActiveAgents([]);
          setPaused(false);
          setStarting(false);
        }
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    fetchLoopStatus();
  }, [fetchLoopStatus]);

  // Re-sync status when WebSocket reconnects (covers missed events)
  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnectedRef.current) {
      fetchLoopStatus();
    }
    prevConnectedRef.current = connected;
  }, [connected, fetchLoopStatus]);

  useEffect(() => {
    const unsubs = [
      subscribe("loop_started", (e) => {
        if (!isForProject(e)) return;
        const agentId = e.agent_id;
        if (agentId) {
          setActiveAgents((prev) => prev.includes(agentId) ? prev : [...prev, agentId]);
        }
        setPaused(false);
        setStarting(false);
      }),
      subscribe("loop_paused", (e) => {
        if (!isForProject(e)) return;
        setPaused(true);
      }),
      subscribe("loop_stopped", (e) => {
        if (!isForProject(e)) return;
        const agentId = e.agent_id;
        if (agentId) {
          setActiveAgents((prev) => prev.filter((id) => id !== agentId));
        } else {
          setActiveAgents([]);
        }
        setPaused(false);
        setStarting(false);
      }),
      subscribe("loop_finished", (e) => {
        if (!isForProject(e)) return;
        const agentId = e.agent_id;
        if (agentId) {
          setActiveAgents((prev) => prev.filter((id) => id !== agentId));
        } else {
          setActiveAgents([]);
        }
        setPaused(false);
        setStarting(false);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, isForProject]);

  const running = activeAgents.length > 0;

  let status: AutomationStatus = "idle";
  if (starting) status = "starting";
  else if (paused) status = "paused";
  else if (running) status = "active";

  const agentCount = activeAgents.length;

  const handleStart = async () => {
    try {
      setStarting(true);
      setActiveTab("tasks");
      const res = await api.startLoop(projectId);
      if (res.active_agents) setActiveAgents(res.active_agents);
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

  const canPlay = (!running && !paused && !starting) || paused;
  const canPause = running && !paused;
  const canStop = running || paused;

  return (
    <>
      <div className={styles.automationBar}>
        <div className={styles.automationLabel}>
          <Text size="sm" style={{ fontWeight: 600 }}>
            Automation
          </Text>
          <StatusBadge status={status} />
          {agentCount > 1 && (
            <Text size="xs" style={{ opacity: 0.7 }}>{agentCount} agents</Text>
          )}
        </div>
        <div className={styles.automationControls}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Play size={14} />}
            onClick={handleStart}
            disabled={!canPlay}
            title={paused ? "Resume" : "Start"}
          />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Pause size={14} />}
            onClick={handlePause}
            disabled={!canPause}
            title="Pause"
          />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Square size={14} />}
            onClick={handleStop}
            disabled={!canStop}
            title="Stop"
          />
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
