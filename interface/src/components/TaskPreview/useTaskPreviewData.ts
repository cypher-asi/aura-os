import { useRef, useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../../api/client";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import { useTaskOutput, useEventStore } from "../../stores/event-store/index";
import type { GitStep } from "../../stores/event-store/index";
import { useTaskStatus } from "../../hooks/use-task-status";
import { useTaskAgentInstances } from "../../hooks/use-task-agent-instances";
import { useTaskStream } from "../../hooks/use-task-stream";
import { useStreamingText } from "../../hooks/stream/hooks";
import { useTaskOutputHydration } from "../../hooks/use-task-output-hydration";
import { useChatUI } from "../../stores/chat-ui-store";
import { projectChatHistoryKey } from "../../stores/chat-history-store";


/**
 * Compute the single-line "what happened with git" caption rendered under
 * the task status badge. Precedence (highest first):
 *
 *   1. commit_rolled_back -> the commit SHA that the harness printed to the
 *      terminal never made it onto main, so we prefer "Rolled back <sha>"
 *      over "Committed <sha>" to avoid misleading the user. The full Git
 *      Activity list still shows the struck-through committed row for
 *      traceability; only the summary caption changes.
 *   2. push_failed (latest step, terminal statuses only) -> surface the push
 *      failure reason as before.
 *   3. push_deferred (latest matching step, terminal statuses only) -> muted
 *      advisory that the task ran locally but the push was skipped. The
 *      backend emits this on every push failure; project_push_stuck escalates
 *      to a header banner once the streak exceeds the threshold.
 *
 * Returns `null` when nothing noteworthy happened (clean commit+push, or the
 * task is still in progress).
 *
 * Exported for direct unit testing from `event-store.test.tsx`.
 */
export function computeTaskGitSummary(
  gitSteps: readonly GitStep[],
  effectiveStatus: string,
): string | null {
  if (gitSteps.length === 0) return null;
  const isTerminal = effectiveStatus === "done" || effectiveStatus === "failed";
  if (!isTerminal) return null;

  // 1. Rollback takes precedence over everything else. A DoD-rejected commit
  //    is semantically "never landed" and the matching preceding `committed`
  //    row in the activity list is already struck through in GitStepItem.
  const rollback = gitSteps.find((s) => s.kind === "commit_rolled_back");
  if (rollback) {
    const sha = rollback.commitSha ? rollback.commitSha.slice(0, 7) : "unknown";
    const reason = rollback.reason ?? "Definition of Done gate rejected the commit";
    return `Rolled back ${sha}: ${reason}`;
  }

  // 2. Push failure wins over push_deferred when both are present on the
  //    same task (push_deferred is always emitted alongside git_push_failed,
  //    but the red-styled failure row carries the canonical reason).
  const latestStep = gitSteps[gitSteps.length - 1] ?? null;
  if (latestStep?.kind === "push_failed") {
    return latestStep.reason ?? "Remote push failed after local completion.";
  }

  // 3. push_deferred (in isolation) - muted advisory for task card caption.
  for (let i = gitSteps.length - 1; i >= 0; i--) {
    const step = gitSteps[i];
    if (step.kind === "push_deferred") {
      return `Push deferred: ${step.reason ?? "remote unavailable"}`;
    }
    if (step.kind === "pushed") {
      // A later successful push supersedes an earlier deferral.
      return null;
    }
  }
  return null;
}

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

export function useTaskPreviewData(task: import("../../shared/types").Task) {
  const taskOutput = useTaskOutput(task.task_id);
  const ctx = useProjectActions();
  const pushPreview = useSidekickStore((s) => s.pushPreview);
  const { agentInstanceId: routeAgentInstanceId } = useParams<{ agentInstanceId: string }>();
  const projectId = ctx?.project.project_id;
  const chatStreamKey =
    projectId && routeAgentInstanceId
      ? projectChatHistoryKey(projectId, routeAgentInstanceId)
      : null;
  const { selectedModel } = useChatUI(chatStreamKey ?? "__task-preview__");
  const [retrying, setRetrying] = useState(false);

  const { liveStatus, liveSessionId, failReason, setLiveStatus, setFailReason } = useTaskStatus(
    task.task_id,
    task.status,
    task.execution_notes,
  );
  const { agentInstance, completedByAgent } = useTaskAgentInstances(projectId, task);

  const effectiveStatus = liveStatus ?? task.status;
  const effectiveSessionId = liveSessionId ?? task.session_id;
  const isActive = effectiveStatus === "in_progress";
  const { streamKey: taskStreamKey } = useTaskStream(task.task_id, isActive);
  const isTerminal = effectiveStatus === "done" || effectiveStatus === "failed";
  const elapsed = useElapsedTime(isActive);

  const streamBuf = useStreamingText(taskStreamKey);
  const seedTaskOutput = useEventStore((s) => s.seedTaskOutput);
  useTaskOutputHydration(projectId, task, isActive, isTerminal, streamBuf, seedTaskOutput);

  const fileOps = taskOutput.fileOps.length > 0
    ? taskOutput.fileOps
    : (task.files_changed ?? []);
  const syncWarning = computeTaskGitSummary(taskOutput.gitSteps, effectiveStatus);
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
    elapsed, failReason, syncWarning, agentInstance, completedByAgent,
    retrying, handleRetry, handleViewSession,
    fileOps, notes, showNotes, streamKey: taskStreamKey,
  };
}

export function useRunTaskData(task: import("../../shared/types").Task) {
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
