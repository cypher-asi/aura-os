import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@cypher-asi/zui";
import { Loader2, Play } from "lucide-react";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../../api/client";
import { useProjectActions } from "../../stores/project-action-store";
import { useLoopActive } from "../../hooks/use-loop-active";
import { useTaskStatus } from "../../hooks/use-task-status";
import styles from "../Preview/Preview.module.css";

export function RunTaskButton({ task }: { task: import("../../types").Task }) {
  const ctx = useProjectActions();
  const { agentInstanceId } = useParams<{ agentInstanceId: string }>();
  const projectId = ctx?.project.project_id;
  const loopActive = useLoopActive(projectId);
  const { liveStatus } = useTaskStatus(task.task_id, task.status);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (liveStatus) setRunning(false);
  }, [liveStatus]);

  const handleRun = useCallback(async () => {
    if (!projectId || running) return;
    setRunning(true);
    try {
      await api.runTask(projectId, task.task_id, agentInstanceId);
    } catch (err) {
      if (isInsufficientCreditsError(err)) dispatchInsufficientCredits();
      console.error("Run task failed:", err);
      setRunning(false);
    }
  }, [running, agentInstanceId, projectId, task.task_id]);

  const effectiveStatus =
    (liveStatus ?? task.status) === "in_progress" && !loopActive && liveStatus === null
      ? "ready"
      : liveStatus ?? task.status;
  const visible = effectiveStatus === "ready";

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon={running ? <Loader2 size={14} className={styles.spinner} /> : <Play size={14} />}
      onClick={visible ? handleRun : undefined}
      disabled={!visible || running}
      title={running ? "Running..." : "Run task"}
      style={visible ? undefined : { visibility: "hidden" }}
    />
  );
}
