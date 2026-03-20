import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Button, Text, GroupCollapsible, Item } from "@cypher-asi/zui";
import { Loader2, FilePlus, FilePen, FileX, RotateCcw, Play, Check, CheckCheck, Copy, XCircle, Wrench, MinusCircle, SkipForward, Terminal } from "lucide-react";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import { useEventContext, useTaskOutput, type BuildStep, type TestStep } from "../context/EventContext";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import { TaskStatusIcon } from "./TaskStatusIcon";
import { toBullets, formatTokens, formatModelName } from "../utils/format";
import { formatCostFromTokens, getCostEstimateLabel } from "../utils/pricing";
import { parseTaskStream } from "../utils/parse-task-stream";
import { deriveActivity, computeIterationStats } from "../utils/derive-activity";
import { getLinkedWorkspaceRoot } from "../utils/projectWorkspace";
import { useLoopActive } from "../hooks/use-loop-active";
import { FormattedRawOutput } from "./FormattedRawOutput";
import { IterationBar } from "./IterationBar";
import type { AgentInstance } from "../types";
import styles from "./Preview.module.css";

function extractErrorMessage(raw: string): string {
  const jsonMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
  if (jsonMatch) return jsonMatch[1];
  const prefixMatch = raw.match(/^[\w\s]+error:\s*(.+)/i);
  if (prefixMatch) return prefixMatch[1];
  return raw;
}

function FileOpIcon({ op }: { op: string }) {
  if (op === "create") return <FilePlus size={12} className={styles.opCreate} />;
  if (op === "modify") return <FilePen size={12} className={styles.opModify} />;
  if (op === "delete") return <FileX size={12} className={styles.opDelete} />;
  return <FilePen size={12} />;
}

export function RunTaskButton({ task }: { task: import("../types").Task }) {
  const { subscribe } = useEventContext();
  const ctx = useProjectContext();
  const { agentInstanceId } = useParams<{ agentInstanceId: string }>();
  const projectId = ctx?.project.project_id;
  const loopActive = useLoopActive(projectId);
  const [runState, setRunState] = useState(() => ({
    taskId: task.task_id,
    running: false,
    liveStatus: null as string | null,
  }));
  const activeRunState =
    runState.taskId === task.task_id
      ? runState
      : { taskId: task.task_id, running: false, liveStatus: null };

  useEffect(() => {
    const unsubs = [
      subscribe("task_started", (e) => {
        if (e.task_id !== task.task_id) return;
        setRunState({ taskId: task.task_id, running: false, liveStatus: "in_progress" });
      }),
      subscribe("task_completed", (e) => {
        if (e.task_id !== task.task_id) return;
        setRunState({ taskId: task.task_id, running: false, liveStatus: "done" });
      }),
      subscribe("task_failed", (e) => {
        if (e.task_id !== task.task_id) return;
        setRunState({ taskId: task.task_id, running: false, liveStatus: "failed" });
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [task.task_id, subscribe]);

  const handleRun = useCallback(async () => {
    if (!projectId || activeRunState.running) return;
    setRunState({ taskId: task.task_id, running: true, liveStatus: null });
    try {
      await api.runTask(projectId, task.task_id, agentInstanceId);
    } catch (err) {
      if (isInsufficientCreditsError(err)) dispatchInsufficientCredits();
      console.error("Run task failed:", err);
      setRunState((prev) =>
        prev.taskId === task.task_id ? { ...prev, running: false } : prev,
      );
    }
  }, [activeRunState.running, agentInstanceId, projectId, task.task_id]);

  const effectiveStatus =
    (activeRunState.liveStatus ?? task.status) === "in_progress" && !loopActive && activeRunState.liveStatus === null
      ? "ready"
      : activeRunState.liveStatus ?? task.status;
  const visible = effectiveStatus === "ready";

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon={activeRunState.running ? <Loader2 size={14} className={styles.spinner} /> : <Play size={14} />}
      onClick={visible ? handleRun : undefined}
      disabled={!visible || activeRunState.running}
      title={activeRunState.running ? "Running..." : "Run task"}
      style={visible ? undefined : { visibility: "hidden" }}
    />
  );
}

function BuildStepIcon({ kind, active }: { kind: BuildStep["kind"]; active: boolean }) {
  switch (kind) {
    case "started":
      return active ? <Loader2 size={12} className={styles.spinner} /> : <Check size={12} />;
    case "passed":
      return <Check size={12} />;
    case "failed":
      return <XCircle size={12} />;
    case "fix_attempt":
      return active ? <Wrench size={12} className={styles.spinner} /> : <Wrench size={12} />;
    case "skipped":
      return <SkipForward size={12} />;
  }
}

function BuildStepItem({ step, active }: { step: BuildStep; active: boolean }) {
  const [expanded, setExpanded] = useState(step.kind === "failed");

  const statusClass =
    step.kind === "passed" ? styles.buildPassed :
    step.kind === "failed" ? styles.buildFailed :
    step.kind === "skipped" ? styles.buildSkipped : "";

  const hasOutput = !!(step.stderr || step.stdout);

  let label: string;
  switch (step.kind) {
    case "started":
      label = active ? `Running \`${step.command}\`...` : `Running \`${step.command}\``;
      break;
    case "passed":
      label = "Build passed";
      break;
    case "failed":
      label = `Build failed${step.attempt ? ` (attempt ${step.attempt})` : ""}`;
      break;
    case "fix_attempt":
      label = active
        ? `Attempting auto-fix${step.attempt ? ` (attempt ${step.attempt})` : ""}...`
        : `Attempting auto-fix${step.attempt ? ` (attempt ${step.attempt})` : ""}`;
      break;
    case "skipped":
      label = step.reason ? `Build verification skipped — ${step.reason}` : "Build verification skipped";
      break;
  }

  return (
    <div className={`${styles.activityItem} ${statusClass}`}>
      <span className={styles.activityIcon}>
        <BuildStepIcon kind={step.kind} active={active} />
      </span>
      <span className={styles.activityBody}>
        <span className={styles.activityMessage}>{label}</span>
        {hasOutput && (
          <button
            className={styles.buildToggle}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Hide output" : "Show output"}
          </button>
        )}
        {expanded && step.stderr && (
          <pre className={styles.buildOutput}>{step.stderr}</pre>
        )}
        {expanded && step.stdout && (
          <pre className={styles.buildOutput}>{step.stdout}</pre>
        )}
      </span>
    </div>
  );
}

function TestResultIcon({ status }: { status: string }) {
  switch (status) {
    case "passed":
      return <Check size={12} className={styles.testPassed} />;
    case "failed":
      return <XCircle size={12} className={styles.testFailed} />;
    case "skipped":
      return <MinusCircle size={12} className={styles.testSkipped} />;
    default:
      return <MinusCircle size={12} />;
  }
}

function TestStepItem({ step, active }: { step: TestStep; active: boolean }) {
  const [expanded, setExpanded] = useState(step.kind === "failed");

  const statusClass =
    step.kind === "passed" ? styles.buildPassed :
    step.kind === "failed" ? styles.buildFailed : "";

  const hasOutput = !!(step.stderr || step.stdout);

  let label: string;
  switch (step.kind) {
    case "started":
      label = active ? `Running tests \`${step.command}\`...` : `Running tests \`${step.command}\``;
      break;
    case "passed":
      label = step.summary ? `Tests passed (${step.summary})` : "Tests passed";
      break;
    case "failed":
      label = `Tests failed${step.attempt ? ` (attempt ${step.attempt})` : ""}${step.summary ? ` — ${step.summary}` : ""}`;
      break;
    case "fix_attempt":
      label = active
        ? `Attempting auto-fix${step.attempt ? ` (attempt ${step.attempt})` : ""}...`
        : `Attempting auto-fix${step.attempt ? ` (attempt ${step.attempt})` : ""}`;
      break;
  }

  return (
    <div className={`${styles.activityItem} ${statusClass}`}>
      <span className={styles.activityIcon}>
        <BuildStepIcon kind={step.kind} active={active} />
      </span>
      <span className={styles.activityBody}>
        <span className={styles.activityMessage}>{label}</span>
        {hasOutput && (
          <button
            className={styles.buildToggle}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Hide output" : "Show output"}
          </button>
        )}
        {expanded && step.stderr && (
          <pre className={styles.buildOutput}>{step.stderr}</pre>
        )}
        {expanded && step.stdout && (
          <pre className={styles.buildOutput}>{step.stdout}</pre>
        )}
        {step.tests.length > 0 && (
          <div className={styles.testResultsList}>
            {step.tests.map((t, i) => (
              <div key={i} className={styles.testResultItem}>
                <TestResultIcon status={t.status} />
                <span className={styles.testResultName}>{t.name}</span>
              </div>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}

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

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

export function TaskPreview({ task }: { task: import("../types").Task }) {
  const { subscribe, seedTaskOutput } = useEventContext();
  const taskOutput = useTaskOutput(task.task_id);
  const ctx = useProjectContext();
  const sidekick = useSidekick();
  const { features } = useAuraCapabilities();
  const { agentInstanceId: routeAgentInstanceId } = useParams<{ agentInstanceId: string }>();
  const projectId = ctx?.project.project_id;
  const loopActive = useLoopActive(projectId);
  const [retrying, setRetrying] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [agentInstance, setAgentInstance] = useState<AgentInstance | null>(null);
  const [completedByAgent, setCompletedByAgent] = useState<AgentInstance | null>(null);
  const hydratedRef = useRef< string | null >(null);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const rawOutputRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyRawOutput = useCallback(() => {
    navigator.clipboard.writeText(taskOutput.text).then(() => {
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    });
  }, [taskOutput.text]);

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

  useEffect(() => {
    setLiveStatus(null);
    setLiveSessionId(null);
    setFailReason(null);
    setAgentInstance(null);
    setCompletedByAgent(null);
  }, [task.task_id]);

  useEffect(() => {
    if (!projectId || !task.assigned_agent_instance_id) {
      setAgentInstance(null);
      return;
    }
    api.getAgentInstance(projectId, task.assigned_agent_instance_id)
      .then(setAgentInstance)
      .catch(() => setAgentInstance(null));
  }, [projectId, task.assigned_agent_instance_id]);

  useEffect(() => {
    if (!projectId || !task.completed_by_agent_instance_id) {
      setCompletedByAgent(null);
      return;
    }
    if (task.completed_by_agent_instance_id === task.assigned_agent_instance_id && agentInstance) {
      setCompletedByAgent(agentInstance);
      return;
    }
    api.getAgentInstance(projectId, task.completed_by_agent_instance_id)
      .then(setCompletedByAgent)
      .catch(() => setCompletedByAgent(null));
  }, [projectId, task.completed_by_agent_instance_id, task.assigned_agent_instance_id, agentInstance]);

  useEffect(() => {
    const unsubs = [
      subscribe("task_started", (e) => {
        if (e.task_id !== task.task_id) return;
        setLiveStatus("in_progress");
        if (e.session_id) setLiveSessionId(e.session_id);
      }),
      subscribe("task_completed", (e) => {
        if (e.task_id !== task.task_id) return;
        setLiveStatus("done");
      }),
      subscribe("task_failed", (e) => {
        if (e.task_id !== task.task_id) return;
        setLiveStatus("failed");
        if (e.reason) setFailReason(e.reason);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [task.task_id, subscribe]);

  useEffect(() => {
    if (!projectId) return;
    if (streamBuf || hydratedRef.current === task.task_id) return;

    const persistedBuildSteps = task.build_steps?.map((s) => ({
      kind: s.kind as BuildStep["kind"],
      command: s.command,
      stderr: s.stderr,
      stdout: s.stdout,
      attempt: s.attempt,
      reason: s.kind === "skipped" ? (s.stdout ?? undefined) : undefined,
      timestamp: 0,
    }));

    const persistedTestSteps = task.test_steps?.map((s) => ({
      kind: s.kind as TestStep["kind"],
      command: s.command,
      stderr: s.stderr,
      stdout: s.stdout,
      attempt: s.attempt,
      tests: s.tests ?? [],
      summary: s.summary,
      timestamp: 0,
    }));

    if (isTerminal || isActive) {
      if (task.live_output || persistedBuildSteps?.length || persistedTestSteps?.length) {
        hydratedRef.current = task.task_id;
        seedTaskOutput(task.task_id, task.live_output, persistedBuildSteps, persistedTestSteps);
      } else {
        hydratedRef.current = task.task_id;
        api.getTaskOutput(projectId, task.task_id).then((res) => {
          const buildKindMap: Record<string, BuildStep["kind"]> = {
            build_verification_skipped: "skipped",
            build_verification_started: "started",
            build_verification_passed: "passed",
            build_verification_failed: "failed",
            build_fix_attempt: "fix_attempt",
          };
          const testKindMap: Record<string, TestStep["kind"]> = {
            test_verification_started: "started",
            test_verification_passed: "passed",
            test_verification_failed: "failed",
            test_fix_attempt: "fix_attempt",
          };
          const loadedBuildSteps = res.build_steps?.map((s: Record<string, unknown>) => ({
            kind: (buildKindMap[(s.type as string) ?? ""] ?? s.kind ?? "started") as BuildStep["kind"],
            command: s.command as string | undefined,
            stderr: s.stderr as string | undefined,
            stdout: s.stdout as string | undefined,
            attempt: s.attempt as number | undefined,
            reason: (s.type === "build_verification_skipped" || s.kind === "skipped") ? (s.reason as string ?? s.stdout as string ?? undefined) : undefined,
            timestamp: 0,
          }));
          const loadedTestSteps = res.test_steps?.map((s: Record<string, unknown>) => ({
            kind: (testKindMap[(s.type as string) ?? ""] ?? s.kind ?? "started") as TestStep["kind"],
            command: s.command as string | undefined,
            stderr: s.stderr as string | undefined,
            stdout: s.stdout as string | undefined,
            attempt: s.attempt as number | undefined,
            tests: (s.tests as { name: string; status: string; message?: string }[]) ?? [],
            summary: s.summary as string | undefined,
            timestamp: 0,
          }));
          if (res.output || loadedBuildSteps?.length || loadedTestSteps?.length) {
            seedTaskOutput(task.task_id, res.output, loadedBuildSteps, loadedTestSteps);
          }
        }).catch((err) => console.warn("Failed to load task output:", err));
      }
    }
  }, [isActive, isTerminal, projectId, task.task_id, task.live_output, streamBuf, seedTaskOutput]);

  const hasOutput = isActive || isTerminal;
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
  const showOutput = activity.length > 0;
  const iterStats = useMemo(() => computeIterationStats(streamBuf), [streamBuf]);

  useEffect(() => {
    if (showRawOutput && rawOutputRef.current) {
      const el = rawOutputRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [showRawOutput, streamBuf]);

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
  }, [projectId, retrying, routeAgentInstanceId, task.task_id]);

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
      <div className={styles.taskMeta}>
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Title</span>
          <Text size="sm">{task.title}</Text>
        </div>
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Status</span>
          <span className={styles.statusRow}>
            <TaskStatusIcon status={effectiveStatus} />
            <Text size="sm">{effectiveStatus.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</Text>
            {isActive && elapsed > 0 && (
              <Text variant="muted" size="xs" as="span">({formatElapsed(elapsed)})</Text>
            )}
            {effectiveStatus === "failed" && (
              <Button
                className={styles.retryBtn}
                variant="ghost"
                size="sm"
                iconOnly
                icon={<RotateCcw size={14} />}
                onClick={handleRetry}
                disabled={retrying}
              />
            )}
          </span>
          {effectiveStatus === "failed" && (failReason || task.execution_notes) && (
            <Text size="xs" className={styles.failReason}>{extractErrorMessage(failReason || task.execution_notes)}</Text>
          )}
        </div>
        {agentInstance && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Assigned to</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {agentInstance.icon && (
                <img src={agentInstance.icon} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }} />
              )}
              <Text size="sm">{agentInstance.name}</Text>
            </span>
          </div>
        )}
        {completedByAgent && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Completed by</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {completedByAgent.icon && (
                <img src={completedByAgent.icon} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }} />
              )}
              <Text size="sm">{completedByAgent.name}</Text>
            </span>
          </div>
        )}
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Description</span>
          {task.description ? (
            <div className={styles.markdown}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {toBullets(task.description)}
              </ReactMarkdown>
            </div>
          ) : (
            <Text size="sm">—</Text>
          )}
        </div>
        {effectiveSessionId && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Session</span>
            <button
              onClick={handleViewSession}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--color-text, #fff)",
                fontSize: 13,
                textAlign: "left",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              {effectiveSessionId.slice(0, 8)}
            </button>
          </div>
        )}
        {task.user_id && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>User</span>
            <Text size="sm">{task.user_id.slice(0, 8)}</Text>
          </div>
        )}
        {task.model && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Model</span>
            <Text size="sm">{formatModelName(task.model)}</Text>
          </div>
        )}
        {(task.total_input_tokens > 0 || task.total_output_tokens > 0) && (
          <>
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Tokens</span>
              <Text size="sm">
                {formatTokens(task.total_input_tokens + task.total_output_tokens)} total
                <Text variant="muted" size="sm" as="span"> ({formatTokens(task.total_input_tokens)} in / {formatTokens(task.total_output_tokens)} out)</Text>
              </Text>
            </div>
            <div className={styles.taskField} title={getCostEstimateLabel()}>
              <span className={styles.fieldLabel}>Cost</span>
              <Text size="sm">{formatCostFromTokens(task.total_input_tokens, task.total_output_tokens, task.model ?? undefined)}</Text>
            </div>
          </>
        )}
      </div>

      {fileOps.length > 0 && (
        <GroupCollapsible label="Files Changed" count={fileOps.length} defaultOpen className={styles.section}>
          {(() => {
            const linkedWorkspaceRoot = getLinkedWorkspaceRoot(ctx?.project);
            const canOpenChangedFiles = features.ideIntegration && Boolean(linkedWorkspaceRoot);

            return (
              <>
                <div className={styles.fileOpsList}>
                  {fileOps.map((f) => {
                    const fullPath = linkedWorkspaceRoot
                      ? `${linkedWorkspaceRoot}/${f.path}`
                      : null;
                    return (
                      <Item
                        key={f.path}
                        onClick={canOpenChangedFiles && fullPath ? () => api.openIde(fullPath) : undefined}
                        className={styles.fileOpItem}
                      >
                        <Item.Icon><FileOpIcon op={f.op} /></Item.Icon>
                        <Item.Label>{f.path}</Item.Label>
                      </Item>
                    );
                  })}
                </div>
                {!canOpenChangedFiles && (
                  <Text variant="muted" size="sm" style={{ padding: "var(--space-2) var(--space-3) 0" }}>
                    Open changed files from a linked desktop workspace.
                  </Text>
                )}
              </>
            );
          })()}
        </GroupCollapsible>
      )}

      {taskOutput.buildSteps.length > 0 && (
        <GroupCollapsible label="Build Verification" count={taskOutput.buildSteps.length} defaultOpen className={styles.section}>
          <div className={styles.liveOutputSection}>
            <div className={styles.activityList}>
              {taskOutput.buildSteps.map((step, i) => (
                <BuildStepItem key={i} step={step} active={i === taskOutput.buildSteps.length - 1} />
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
                <TestStepItem key={i} step={step} active={i === taskOutput.testSteps.length - 1} />
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

      {showOutput && (
        <GroupCollapsible label={isActive ? "Live Output" : "Output"} defaultOpen className={styles.section}>
          {iterStats.total > 0 && (
            <IterationBar stats={iterStats} dots={iterStats.dots} isActive={isActive} />
          )}
          <div className={styles.liveOutputSection}>
            <div className={styles.activityList}>
              {activity.map((item) => (
                <div key={item.id} className={styles.activityItem} data-status={item.status}>
                  <span className={styles.activityIcon} data-status={item.status}>
                    {item.status === "active"
                      ? <Loader2 size={12} className={styles.spinner} />
                      : <Check size={12} />}
                  </span>
                  <span className={styles.activityBody}>
                    <span className={styles.activityMessage}>{item.message}</span>
                    {item.detail && (
                      <span className={styles.activityDetail}> {item.detail}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {streamBuf.length > 0 && (
              <div className={styles.rawOutputToggleRow}>
                <button
                  className={styles.rawOutputToggle}
                  onClick={() => setShowRawOutput((v) => !v)}
                >
                  <Terminal size={11} />
                  {showRawOutput ? "Hide raw output" : "Show raw output"}
                </button>
                <div className={styles.rawOutputActions}>
                  <Text variant="muted" size="xs" className={styles.streamProgress}>
                    {(streamBuf.length / 1024).toFixed(1)} KB
                  </Text>
                  <button
                    className={styles.copyRawBtn}
                    onClick={copyRawOutput}
                    aria-label="Copy raw output"
                  >
                    {copied ? <CheckCheck size={11} /> : <Copy size={11} />}
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            )}
            {showRawOutput && streamBuf.length > 0 && (
              <FormattedRawOutput ref={rawOutputRef} buffer={streamBuf} />
            )}
          </div>
        </GroupCollapsible>
      )}
    </>
  );
}
