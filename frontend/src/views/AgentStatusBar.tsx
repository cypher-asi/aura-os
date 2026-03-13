import { useEffect, useState } from "react";
import type { ProjectId, Agent, Session } from "../types";
import { api } from "../api/client";
import { useEventContext } from "../context/EventContext";
import { StatusBadge } from "../components/StatusBadge";
import styles from "./execution.module.css";

interface AgentStatusBarProps {
  projectId: ProjectId;
}

export function AgentStatusBar({ projectId }: AgentStatusBarProps) {
  const { connected, subscribe } = useEventContext();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [currentTaskTitle, setCurrentTaskTitle] = useState<string | null>(null);

  useEffect(() => {
    api
      .listAgents(projectId)
      .then((agents) => {
        if (agents.length > 0) {
          setAgent(agents[0]);
          api
            .listSessions(projectId, agents[0].agent_id)
            .then((sessions: Session[]) => setSessionCount(sessions.length));
        }
      })
      .catch(console.error);
  }, [projectId]);

  useEffect(() => {
    const unsubs = [
      subscribe("task_started", (e) => {
        setCurrentTaskTitle(e.task_title || null);
      }),
      subscribe("task_completed", () => {
        setCurrentTaskTitle(null);
      }),
      subscribe("task_failed", () => {
        setCurrentTaskTitle(null);
      }),
      subscribe("session_rolled_over", () => {
        setSessionCount((c) => c + 1);
      }),
      subscribe("loop_paused", () => {
        setCurrentTaskTitle(null);
      }),
      subscribe("loop_stopped", () => {
        setCurrentTaskTitle(null);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe]);

  return (
    <div className={styles.statusBar}>
      <div className={styles.statusItem}>
        <span
          className={`${styles.connDot} ${connected ? styles.connDotOn : styles.connDotOff}`}
        />
        <span className={styles.statusLabel}>
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>

      <div className={styles.statusItem}>
        <span className={styles.statusLabel}>Agent:</span>
        <span className={styles.statusValue}>{agent?.name || "—"}</span>
        {agent && <StatusBadge status={agent.status} />}
      </div>

      <div className={styles.statusItem}>
        <span className={styles.statusLabel}>Session:</span>
        <span className={styles.statusValue}>#{sessionCount || 0}</span>
      </div>

      <div className={styles.currentTask}>
        {currentTaskTitle ? (
          <>
            <span style={{ color: "var(--color-text-dim)", fontWeight: 400 }}>
              Working on:{" "}
            </span>
            {currentTaskTitle}
          </>
        ) : (
          <span style={{ color: "var(--color-text-dim)", fontWeight: 400 }}>
            Idle
          </span>
        )}
      </div>
    </div>
  );
}
