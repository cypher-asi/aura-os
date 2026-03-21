import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Button, GroupCollapsible } from "@cypher-asi/zui";
import { Loader2, Play } from "lucide-react";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../api/client";
import { useSidekick } from "../stores/sidekick-store";
import { useProjectContext } from "../stores/project-action-store";
import { useEventStore, useTaskOutput } from "../stores/event-store";
import { useLoopActive } from "../hooks/use-loop-active";
import { useTaskStatus } from "../hooks/use-task-status";
import { useTaskAgentInstances } from "../hooks/use-task-agent-instances";
import { useTaskOutputHydration } from "../hooks/use-task-output-hydration";
import { VerificationStepItem } from "./VerificationStepItem";
import { TaskMetaSection } from "./TaskMetaSection";
import { TaskFilesSection } from "./TaskFilesSection";
import { TaskOutputSection } from "./TaskOutputSection";
import { toBullets } from "../utils/format";
import { parseTaskStream } from "../utils/parse-task-stream";
import { deriveActivity, computeIterationStats } from "../utils/derive-activity";
import styles from "./Preview.module.css";

function useElapsedTime(active: boolean) {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      return;
    }
    startRef.current = Date.now();
    const id = setInterval(() => {
      if (startRef.current !== null) {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return active ? elapsed : 0;
}

export function RunTaskButton({ task }: { task: import("../types").Task }) {
  const ctx = useProjectContext();
  const { agentInstanceId } = useParams<{ agentInstanceId: string }>();
  const projectId = ctx?.project.project_id;
  const loopActive = useLoopActive(projectId);
  const { liveStatus } = useTaskStatus(task.task_id);
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

export function TaskPreview({ task }: { task: import("../types").Task }) {
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

  const streamBuf = taskOutput.text;
  const liveFileOps = taskOutput.fileOps;

  const rawStatus = liveStatus ?? task.status;
  const effectiveStatus =
    rawStatus === "in_progress" && !loopActive && liveStatus === null
      ? "ready"
      : rawStatus;
  const effectiveSessionId = liveSessionId ?? task.session_id;
  const isActive = effectiveStatus === "in_progress";
  const isTerminal = effectiveStatus === "done" || effectiveStatus === "failed";
  const elapsed = useElapsedTime(isActive);

  useTaskOutputHydration(projectId, task, isActive, isTerminal, streamBuf, seedTaskOutput);

  const hasOutput = isActive || isTerminal || !!streamBuf;
  const parsed = useMemo(() => (hasOutput && streamBuf ? parseTaskStream(streamBuf) : null), [hasOutput, streamBuf]);

  const fileOps = hasOutput
    ? (liveFileOps.length > 0 ? liveFileOps : parsed?.fileOps ?? (task.files_changed ?? []))
    : (task.files_changed ?? []);

  const notes = hasOutput
    ? (parsed?.notes ?? task.execution_notes)
    : task.execution_notes;

  const showNotes = hasOutput ? (parsed?.notes != null || !!task.execution_notes) : !!task.execution_notes;

  const activity = useMemo(() => {
    if (!hasOutput || (!isActive && !streamBuf)) return [];
    const items = deriveActivity(streamBuf);

    if (isTerminal) return items.map((item) => ({ ...item, status: "done" as const }));

    const buildSteps = taskOutput.buildSteps;
    const testSteps = taskOutput.testSteps;
    const allStreamDone = items.length > 0 && items.every((i) => i.status === "done");

    if (allStreamDone && (buildSteps.length > 0 || testSteps.length > 0)) {
      const lastBuild = buildSteps[buildSteps.length - 1];
      const lastTest = testSteps[testSteps.length - 1];

      if (lastBuild && lastBuild.kind !== "passed") {
        const label =
          lastBuild.kind === "failed"
            ? `Build failed (attempt ${lastBuild.attempt ?? "?"}), retrying...`
            : lastBuild.kind === "fix_attempt"
              ? `Applying auto-fix (attempt ${lastBuild.attempt ?? "?"})...`
              : "Running build verification...";
        items.push({ id: "build-verify", message: label, status: "active" });
      } else if (lastBuild?.kind === "passed") {
        items.push({ id: "build-verify", message: "Build verified", status: "done" });
      }

      if (lastTest && lastTest.kind !== "passed") {
        const label =
          lastTest.kind === "failed"
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
  }, [hasOutput, isActive, isTerminal, streamBuf, taskOutput.buildSteps, taskOutput.testSteps]);

  const iterStats = useMemo(() => computeIterationStats(streamBuf), [streamBuf]);

  const handleRetry = useCallback(async () => {
    if (!projectId || retrying) return;
    setRetrying(true);
    try {
      await api.retryTask(projectId, task.task_id);
      setLiveStatus("ready");
      setFailReason(null);
      try {
        await api.runTask(projectId, task.task_id, routeAgentInstanceId);
      } catch {
        // Task is at least reset to Ready; user can run manually
      }
    } catch (err) {
      console.error("Retry failed:", err);
    } finally {
      setRetrying(false);
    }
  }, [projectId, retrying, routeAgentInstanceId, task.task_id, setLiveStatus, setFailReason]);

  const handleViewSession = useCallback(async () => {
    if (!projectId || !effectiveSessionId) return;
    try {
      const assignedAgentInstanceId = task.assigned_agent_instance_id;
      if (!assignedAgentInstanceId) {
        const instances = await api.listAgentInstances(projectId);
        for (const a of instances) {
          try {
            const s = await api.getSession(projectId, a.agent_instance_id, effectiveSessionId);
            sidekick.pushPreview({ kind: "session", session: s });
            return;
          } catch { /* try next agent instance */ }
        }
        console.error("Failed to load session: agent instance not found");
        return;
      }
      const session = await api.getSession(projectId, assignedAgentInstanceId, effectiveSessionId);
      sidekick.pushPreview({ kind: "session", session });
    } catch (err) {
      console.error("Failed to load session:", err);
    }
  }, [projectId, effectiveSessionId, task.assigned_agent_instance_id, sidekick]);

  return (
    <>
      <TaskMetaSection
        task={task}
        effectiveStatus={effectiveStatus}
        effectiveSessionId={effectiveSessionId}
        isActive={isActive}
        elapsed={elapsed}
        failReason={failReason}
        agentInstance={agentInstance}
        completedByAgent={completedByAgent}
        retrying={retrying}
        onRetry={handleRetry}
        onViewSession={handleViewSession}
      />

      <TaskFilesSection fileOps={fileOps} />

      {taskOutput.buildSteps.length > 0 && (
        <GroupCollapsible label="Build Verification" count={taskOutput.buildSteps.length} defaultOpen className={styles.section}>
          <div className={styles.liveOutputSection}>
            <div className={styles.activityList}>
              {taskOutput.buildSteps.map((step, i) => (
                <VerificationStepItem key={i} step={step} active={i === taskOutput.buildSteps.length - 1} variant="build" />
              ))}
            </div>
          </div>
        </GroupCollapsible>
      )}

      {taskOutput.testSteps.length > 0 && (
        <GroupCollapsible label="Test Verification" count={taskOutput.testSteps.length} defaultOpen className={styles.section}>
          <div className={styles.liveOutputSection}>
            <div className={styles.activityList}>
              {taskOutput.testSteps.map((step, i) => (
                <VerificationStepItem key={i} step={step} active={i === taskOutput.testSteps.length - 1} variant="test" />
              ))}
            </div>
          </div>
        </GroupCollapsible>
      )}

      {showNotes && (
        <GroupCollapsible label="Notes" defaultOpen className={styles.section}>
          <div className={styles.notesContent}>
            <div className={styles.markdown}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {toBullets(notes || "")}
              </ReactMarkdown>
            </div>
          </div>
        </GroupCollapsible>
      )}

      <TaskOutputSection
        isActive={isActive}
        activity={activity}
        iterStats={iterStats}
        streamBuf={streamBuf}
      />
    </>
  );
}
