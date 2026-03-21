import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../../api/client";
import { useSidekick } from "../../stores/sidekick-store";
import { useProjectContext } from "../../stores/project-action-store";
import { useEventStore, useTaskOutput } from "../../stores/event-store";
import { useLoopActive } from "../../hooks/use-loop-active";
import { useTaskStatus } from "../../hooks/use-task-status";
import { useTaskAgentInstances } from "../../hooks/use-task-agent-instances";
import { useTaskOutputHydration } from "../../hooks/use-task-output-hydration";
import { parseTaskStream } from "../../utils/parse-task-stream";
import { deriveActivity, computeIterationStats } from "../../utils/derive-activity";

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

function buildActivityItems(
  hasOutput: boolean, isActive: boolean, isTerminal: boolean,
  streamBuf: string,
  buildSteps: ReturnType<typeof useTaskOutput>["buildSteps"],
  testSteps: ReturnType<typeof useTaskOutput>["testSteps"],
): ReturnType<typeof deriveActivity> {
  if (!hasOutput || (!isActive && !streamBuf)) return [];
  const items = deriveActivity(streamBuf);
  if (isTerminal) return items.map((item) => ({ ...item, status: "done" as const }));

  const allStreamDone = items.length > 0 && items.every((i) => i.status === "done");

  if (allStreamDone && (buildSteps.length > 0 || testSteps.length > 0)) {
    const lastBuild = buildSteps[buildSteps.length - 1];
    const lastTest = testSteps[testSteps.length - 1];

    if (lastBuild && lastBuild.kind !== "passed") {
      const label = lastBuild.kind === "failed"
        ? `Build failed (attempt ${lastBuild.attempt ?? "?"}), retrying...`
        : lastBuild.kind === "fix_attempt"
          ? `Applying auto-fix (attempt ${lastBuild.attempt ?? "?"})...`
          : "Running build verification...";
      items.push({ id: "build-verify", message: label, status: "active" });
    } else if (lastBuild?.kind === "passed") {
      items.push({ id: "build-verify", message: "Build verified", status: "done" });
    }

    if (lastTest && lastTest.kind !== "passed") {
      const label = lastTest.kind === "failed"
        ? `Tests failed (attempt ${lastTest.attempt ?? "?"}), retrying...`
        : lastTest.kind === "fix_attempt"
          ? `Applying test fix (attempt ${lastTest.attempt ?? "?"})...`
          : "Running tests...";
      items.push({ id: "test-verify", message: label, status: "active" });
    } else if (lastTest?.kind === "passed") {
      items.push({ id: "test-verify", message: "Tests passed", status: "done" });
    }
  } else if (allStreamDone && isActive) {
    items.push({ id: "build-verify", message: "Running build verification...", status: "active" });
  }

  return items;
}

export function useTaskPreviewData(task: import("../types").Task) {
  const seedTaskOutput = useEventStore((s) => s.seedTaskOutput);
  const taskOutput = useTaskOutput(task.task_id);
  const ctx = useProjectContext();
  const sidekick = useSidekick();
  const { agentInstanceId: routeAgentInstanceId } = useParams<{ agentInstanceId: string }>();
  const projectId = ctx?.project.project_id;
  const loopActive = useLoopActive(projectId);
  const [retrying, setRetrying] = useState(false);

  const { liveStatus, liveSessionId, failReason, setLiveStatus, setFailReason } = useTaskStatus(task.task_id);
  const { agentInstance, completedByAgent } = useTaskAgentInstances(projectId, task);

  const rawStatus = liveStatus ?? task.status;
  const effectiveStatus = rawStatus === "in_progress" && !loopActive && liveStatus === null ? "ready" : rawStatus;
  const effectiveSessionId = liveSessionId ?? task.session_id;
  const isActive = effectiveStatus === "in_progress";
  const isTerminal = effectiveStatus === "done" || effectiveStatus === "failed";
  const elapsed = useElapsedTime(isActive);

  const streamBuf = taskOutput.text;
  const liveFileOps = taskOutput.fileOps;

  useTaskOutputHydration(projectId, task, isActive, isTerminal, streamBuf, seedTaskOutput);

  const hasOutput = isActive || isTerminal || !!streamBuf;
  const parsed = useMemo(() => (hasOutput && streamBuf ? parseTaskStream(streamBuf) : null), [hasOutput, streamBuf]);

  const fileOps = hasOutput
    ? (liveFileOps.length > 0 ? liveFileOps : parsed?.fileOps ?? (task.files_changed ?? []))
    : (task.files_changed ?? []);

  const notes = hasOutput ? (parsed?.notes ?? task.execution_notes) : task.execution_notes;
  const showNotes = hasOutput ? (parsed?.notes != null || !!task.execution_notes) : !!task.execution_notes;

  const activity = useMemo(
    () => buildActivityItems(hasOutput, isActive, isTerminal, streamBuf, taskOutput.buildSteps, taskOutput.testSteps),
    [hasOutput, isActive, isTerminal, streamBuf, taskOutput.buildSteps, taskOutput.testSteps],
  );
  const iterStats = useMemo(() => computeIterationStats(streamBuf), [streamBuf]);

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
    fileOps, notes, showNotes, activity, iterStats, streamBuf,
  };
}

export function useRunTaskData(task: import("../types").Task) {
  const ctx = useProjectContext();
  const { agentInstanceId } = useParams<{ agentInstanceId: string }>();
  const projectId = ctx?.project.project_id;
  const loopActive = useLoopActive(projectId);
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

  const effectiveStatus = (liveStatus ?? task.status) === "in_progress" && !loopActive && liveStatus === null
    ? "ready" : liveStatus ?? task.status;

  return { running, handleRun, visible: effectiveStatus === "ready" };
}
