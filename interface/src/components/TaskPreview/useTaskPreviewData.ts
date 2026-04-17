import { useRef, useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../../api/client";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import { useTaskOutput, useEventStore } from "../../stores/event-store/index";
import { useTaskStatus } from "../../hooks/use-task-status";
import { useTaskAgentInstances } from "../../hooks/use-task-agent-instances";
import { useTaskStream } from "../../hooks/use-task-stream";
import { useStreamingText } from "../../hooks/stream/hooks";
import { useTaskOutputHydration } from "../../hooks/use-task-output-hydration";
import { useChatUI } from "../../stores/chat-ui-store";
import { projectChatHistoryKey } from "../../stores/chat-history-store";

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
  const ctx = useProjectActions();
  const pushPreview = useSidekickStore((s) => s.pushPreview);
  const { agentInstanceId: routeAgentInstanceId } = useParams<{ agentInstanceId: string }>();
  const projectId = ctx?.project.project_id;
  const streamKey =
    projectId && routeAgentInstanceId
      ? projectChatHistoryKey(projectId, routeAgentInstanceId)
      : null;
  const { selectedModel } = useChatUI(streamKey ?? "__task-preview__");
  const [retrying, setRetrying] = useState(false);

  const { liveStatus, liveSessionId, failReason, setLiveStatus, setFailReason } = useTaskStatus(task.task_id, task.status);
  const { agentInstance, completedByAgent } = useTaskAgentInstances(projectId, task);

  const effectiveStatus = liveStatus ?? task.status;
  const effectiveSessionId = liveSessionId ?? task.session_id;
  const isActive = effectiveStatus === "in_progress";
  const { streamKey: taskStreamKey } = useTaskStream(task.task_id, isActive);
  const isTerminal = effectiveStatus === "done" || effectiveStatus === "failed";
  const elapsed = useElapsedTime(isActive);

  const streamBuf = useStreamingText(streamKey);
  const seedTaskOutput = useEventStore((s) => s.seedTaskOutput);
  useTaskOutputHydration(projectId, task, isActive, isTerminal, streamBuf, seedTaskOutput);

  const fileOps = taskOutput.fileOps.length > 0
    ? taskOutput.fileOps
    : (task.files_changed ?? []);
  const notes = task.execution_notes || null;
  const showNotes = !!notes;

  const handleRetry = useCallback(async () => {
    if (!projectId || retrying) return;
    setRetrying(true);
    try {
      await api.retryTask(projectId, task.task_id);
      setLiveStatus("ready"); setFailReason(null);
      try {
        await api.runTask(projectId, task.task_id, routeAgentInstanceId, selectedModel);
      } catch { /* reset to Ready */ }
    } catch (err) { console.error("Retry failed:", err); }
    finally { setRetrying(false); }
  }, [projectId, retrying, routeAgentInstanceId, selectedModel, task.task_id, setLiveStatus, setFailReason]);

  const handleViewSession = useCallback(async () => {
    if (!projectId || !effectiveSessionId) return;
    try {
      const assignedId = task.assigned_agent_instance_id;
      if (!assignedId) {
        const instances = await api.listAgentInstances(projectId);
        for (const a of instances) {
          try {
            const s = await api.getSession(projectId, a.agent_instance_id, effectiveSessionId);
            pushPreview({ kind: "session", session: s }); return;
          } catch { /* try next */ }
        }
        console.error("Failed to load session: agent instance not found"); return;
      }
      const session = await api.getSession(projectId, assignedId, effectiveSessionId);
      pushPreview({ kind: "session", session });
    } catch (err) { console.error("Failed to load session:", err); }
  }, [projectId, effectiveSessionId, task.assigned_agent_instance_id, pushPreview]);

  return {
    taskOutput, effectiveStatus, effectiveSessionId, isActive, isTerminal,
    elapsed, failReason, agentInstance, completedByAgent,
    retrying, handleRetry, handleViewSession,
    fileOps, notes, showNotes, streamKey: taskStreamKey,
  };
}

export function useRunTaskData(task: import("../../types").Task) {
  const ctx = useProjectActions();
  const { agentInstanceId } = useParams<{ agentInstanceId: string }>();
  const projectId = ctx?.project.project_id;
  const streamKey =
    projectId && agentInstanceId ? projectChatHistoryKey(projectId, agentInstanceId) : null;
  const { selectedModel } = useChatUI(streamKey ?? "__task-preview-run__");
  const { liveStatus } = useTaskStatus(task.task_id, task.status);
  const [running, setRunning] = useState(false);

  useEffect(() => { if (liveStatus) setRunning(false); }, [liveStatus]);

  const handleRun = useCallback(async () => {
    if (!projectId || running) return;
    setRunning(true);
    try { await api.runTask(projectId, task.task_id, agentInstanceId, selectedModel); }
    catch (err) {
      if (isInsufficientCreditsError(err)) dispatchInsufficientCredits();
      console.error("Run task failed:", err); setRunning(false);
    }
  }, [running, agentInstanceId, projectId, selectedModel, task.task_id]);

  const effectiveStatus = liveStatus ?? task.status;

  return { running, handleRun, visible: effectiveStatus === "ready" };
}
