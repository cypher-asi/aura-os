import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../../api/client";
import { useSidekick } from "../../stores/sidekick-store";
import { useProjectContext } from "../../stores/project-action-store";
import { useTaskOutput } from "../../stores/event-store";
import { useTaskStatus } from "../../hooks/use-task-status";
import { useTaskAgentInstances } from "../../hooks/use-task-agent-instances";
import { useTaskStream } from "../../hooks/use-task-stream";
import { parseTaskStream } from "../../utils/parse-task-stream";

function useElapsedTime(active: boolean): number {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) { startRef.current = null; return; }
    startRef.current = Date.now();
    const id = setInterval(() => {
      if (startRef.current !== null) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return active ? elapsed : 0;
}

export function useTaskPreviewData(task: import("../../types").Task) {
  const taskOutput = useTaskOutput(task.task_id);
  const { streamKey } = useTaskStream(task.task_id);
  const ctx = useProjectContext();
  const sidekick = useSidekick();
  const { agentInstanceId: routeAgentInstanceId } = useParams<{ agentInstanceId: string }>();
  const projectId = ctx?.project.project_id;
  const [retrying, setRetrying] = useState(false);

  const { liveStatus, liveSessionId, failReason, setLiveStatus, setFailReason } = useTaskStatus(task.task_id);
  const { agentInstance, completedByAgent } = useTaskAgentInstances(projectId, task);

  const effectiveStatus = liveStatus ?? task.status;
  const effectiveSessionId = liveSessionId ?? task.session_id;
  const isActive = effectiveStatus === "in_progress";
  const isTerminal = effectiveStatus === "done" || effectiveStatus === "failed";
  const elapsed = useElapsedTime(isActive);

  const streamBuf = taskOutput.text;
  const liveFileOps = taskOutput.fileOps;

  const hasOutput = isActive || isTerminal || !!streamBuf;
  const parsed = useMemo(() => (hasOutput && streamBuf ? parseTaskStream(streamBuf) : null), [hasOutput, streamBuf]);

  const fileOps = hasOutput
    ? (liveFileOps.length > 0 ? liveFileOps : parsed?.fileOps ?? (task.files_changed ?? []))
    : (task.files_changed ?? []);

  const notes = hasOutput ? (parsed?.notes ?? task.execution_notes) : task.execution_notes;
  const showNotes = hasOutput ? (parsed?.notes != null || !!task.execution_notes) : !!task.execution_notes;

  const handleRetry = useCallback(async () => {
    if (!projectId || retrying) return;
    setRetrying(true);
    try {
      await api.retryTask(projectId, task.task_id);
      setLiveStatus("ready"); setFailReason(null);
      try { await api.runTask(projectId, task.task_id, routeAgentInstanceId); } catch { /* reset to Ready */ }
    } catch (err) { console.error("Retry failed:", err); }
    finally { setRetrying(false); }
  }, [projectId, retrying, routeAgentInstanceId, task.task_id, setLiveStatus, setFailReason]);

  const handleViewSession = useCallback(async () => {
    if (!projectId || !effectiveSessionId) return;
    try {
      const assignedId = task.assigned_agent_instance_id;
      if (!assignedId) {
        const instances = await api.listAgentInstances(projectId);
        for (const a of instances) {
          try {
            const s = await api.getSession(projectId, a.agent_instance_id, effectiveSessionId);
            sidekick.pushPreview({ kind: "session", session: s }); return;
          } catch { /* try next */ }
        }
        console.error("Failed to load session: agent instance not found"); return;
      }
      const session = await api.getSession(projectId, assignedId, effectiveSessionId);
      sidekick.pushPreview({ kind: "session", session });
    } catch (err) { console.error("Failed to load session:", err); }
  }, [projectId, effectiveSessionId, task.assigned_agent_instance_id, sidekick]);

  return {
    taskOutput, effectiveStatus, effectiveSessionId, isActive, isTerminal,
    elapsed, failReason, agentInstance, completedByAgent,
    retrying, handleRetry, handleViewSession,
    fileOps, notes, showNotes, streamKey,
  };
}

export function useRunTaskData(task: import("../../types").Task) {
  const ctx = useProjectContext();
  const { agentInstanceId } = useParams<{ agentInstanceId: string }>();
  const projectId = ctx?.project.project_id;
  const { liveStatus } = useTaskStatus(task.task_id);
  const [running, setRunning] = useState(false);

  useEffect(() => { if (liveStatus) setRunning(false); }, [liveStatus]);

  const handleRun = useCallback(async () => {
    if (!projectId || running) return;
    setRunning(true);
    try { await api.runTask(projectId, task.task_id, agentInstanceId); }
    catch (err) {
      if (isInsufficientCreditsError(err)) dispatchInsufficientCredits();
      console.error("Run task failed:", err); setRunning(false);
    }
  }, [running, agentInstanceId, projectId, task.task_id]);

  const effectiveStatus = liveStatus ?? task.status;

  return { running, handleRun, visible: effectiveStatus === "ready" };
}
