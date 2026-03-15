import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Button, Text, GroupCollapsible, Item } from "@cypher-asi/zui";
import { X, ArrowLeft, Loader2, FilePlus, FilePen, FileX, RotateCcw, Play, Check, XCircle, Wrench, MinusCircle, SkipForward } from "lucide-react";
import { api } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import { useEventContext, useTaskOutput, type BuildStep, type TestStep } from "../context/EventContext";
import { TaskStatusIcon } from "./TaskStatusIcon";
import { formatRelativeTime, toBullets, formatTokens, formatModelName } from "../utils/format";
import { formatCostFromTokens } from "../utils/pricing";
import { parseTaskStream } from "../utils/parse-task-stream";
import { deriveActivity } from "../utils/derive-activity";
import type { PreviewItem } from "../context/SidekickContext";
import type { Task, Session } from "../types";
import { StatusBadge } from "./StatusBadge";
import { CodeEditor } from "../ide";
import styles from "./Preview.module.css";

function extractErrorMessage(raw: string): string {
  const jsonMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
  if (jsonMatch) return jsonMatch[1];
  const prefixMatch = raw.match(/^[\w\s]+error:\s*(.+)/i);
  if (prefixMatch) return prefixMatch[1];
  return raw;
}

function SpecPreview({ spec }: { spec: import("../types").Spec }) {
  return (
    <div className={`${styles.markdown} ${styles.specMarkdown}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {spec.markdown_contents}
      </ReactMarkdown>
    </div>
  );
}

function FileOpIcon({ op }: { op: string }) {
  if (op === "create") return <FilePlus size={12} className={styles.opCreate} />;
  if (op === "modify") return <FilePen size={12} className={styles.opModify} />;
  if (op === "delete") return <FileX size={12} className={styles.opDelete} />;
  return <FilePen size={12} />;
}

function RunTaskButton({ task }: { task: import("../types").Task }) {
  const { subscribe } = useEventContext();
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState(task.status);

  useEffect(() => {
    setStatus(task.status);
    setRunning(false);
  }, [task.task_id, task.status]);

  useEffect(() => {
    const unsubs = [
      subscribe("task_started", (e) => {
        if (e.task_id !== task.task_id) return;
        setStatus("in_progress");
        setRunning(false);
      }),
      subscribe("task_completed", (e) => {
        if (e.task_id !== task.task_id) return;
        setStatus("done");
      }),
      subscribe("task_failed", (e) => {
        if (e.task_id !== task.task_id) return;
        setStatus("failed");
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [task.task_id, subscribe]);

  const handleRun = useCallback(async () => {
    if (!projectId || running) return;
    setRunning(true);
    try {
      await api.runTask(projectId, task.task_id);
    } catch (err) {
      console.error("Run task failed:", err);
      setRunning(false);
    }
  }, [projectId, task.task_id, running]);

  const visible = status === "ready";

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
        {step.tests.length > 0 && (
          <div className={styles.testResultsList}>
            {step.tests.map((t, i) => (
              <div key={i} className={styles.testResultItem}>
                <TestResultIcon status={t.status} />
                <span className={styles.testResultName}>{t.name}</span>
                {t.message && t.status === "failed" && (
                  <div className={styles.testErrorMsg}>{t.message}</div>
                )}
              </div>
            ))}
          </div>
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

function useElapsedTime(active: boolean) {
  const startRef = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return elapsed;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function TaskPreview({ task }: { task: import("../types").Task }) {
  const { subscribe, seedTaskOutput } = useEventContext();
  const taskOutput = useTaskOutput(task.task_id);
  const ctx = useProjectContext();
  const sidekick = useSidekick();
  const projectId = ctx?.project.project_id;
  const [retrying, setRetrying] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const hydratedRef = useRef<string | null>(null);

  const streamBuf = taskOutput.text;
  const liveFileOps = taskOutput.fileOps;

  const effectiveStatus = liveStatus ?? task.status;
  const effectiveSessionId = liveSessionId ?? task.session_id;
  const isActive = effectiveStatus === "in_progress";
  const isTerminal = effectiveStatus === "done" || effectiveStatus === "failed";
  const elapsed = useElapsedTime(isActive);

  useEffect(() => {
    setLiveStatus(null);
    setLiveSessionId(null);
    setFailReason(null);
  }, [task.task_id]);

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

  // Hydrate from persisted live_output or server buffer when global buffer is empty
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

    if (isTerminal) {
      if (task.live_output || persistedBuildSteps?.length || persistedTestSteps?.length) {
        hydratedRef.current = task.task_id;
        seedTaskOutput(task.task_id, task.live_output, persistedBuildSteps, persistedTestSteps);
      }
      return;
    }

    if (!isActive) return;
    hydratedRef.current = task.task_id;

    if (task.live_output) {
      seedTaskOutput(task.task_id, task.live_output, persistedBuildSteps, persistedTestSteps);
      return;
    }

    api.getTaskOutput(projectId, task.task_id).then((res) => {
      if (res.output) seedTaskOutput(task.task_id, res.output);
    }).catch(() => {});
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

  const handleRetry = useCallback(async () => {
    if (!projectId || retrying) return;
    setRetrying(true);
    try {
      await api.retryTask(projectId, task.task_id);
      setLiveStatus("ready");
      setFailReason(null);
      // Auto-run the task after resetting it
      try {
        await api.runTask(projectId, task.task_id);
      } catch {
        // Task is at least reset to Ready; user can run manually
      }
    } catch (err) {
      console.error("Retry failed:", err);
    } finally {
      setRetrying(false);
    }
  }, [projectId, task.task_id, retrying]);

  const handleViewSession = useCallback(async () => {
    if (!projectId || !effectiveSessionId) return;
    try {
      let agentId = task.assigned_agent_id;
      if (!agentId) {
        const agents = await api.listAgents(projectId);
        for (const a of agents) {
          try {
            const s = await api.getSession(projectId, a.agent_id, effectiveSessionId);
            sidekick.pushPreview({ kind: "session", session: s });
            return;
          } catch { /* try next agent */ }
        }
        console.error("Failed to load session: agent not found");
        return;
      }
      const session = await api.getSession(projectId, agentId, effectiveSessionId);
      sidekick.pushPreview({ kind: "session", session });
    } catch (err) {
      console.error("Failed to load session:", err);
    }
  }, [projectId, effectiveSessionId, task.assigned_agent_id, sidekick]);

  const emptyBuildMessage = isActive
    ? "Build verification pending..."
    : isTerminal
      ? "No build verification recorded"
      : "—";

  const emptyTestMessage = isActive
    ? "Test verification pending..."
    : isTerminal
      ? "No tests recorded"
      : "—";

  return (
    <>
      <div className={styles.taskMeta}>
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
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Cost</span>
              <Text size="sm">{formatCostFromTokens(task.total_input_tokens, task.total_output_tokens, task.model ?? undefined)}</Text>
            </div>
          </>
        )}
      </div>

      {fileOps.length > 0 && (
        <GroupCollapsible label="Files Changed" count={fileOps.length} defaultOpen className={styles.section}>
          <div className={styles.fileOpsList}>
            {fileOps.map((f) => {
              const fullPath = ctx?.project.linked_folder_path
                ? `${ctx.project.linked_folder_path}/${f.path}`.replace(/\//g, "\\")
                : f.path;
              return (
                <Item
                  key={f.path}
                  onClick={() => setEditorPath(fullPath)}
                  className={styles.fileOpItem}
                >
                  <Item.Icon><FileOpIcon op={f.op} /></Item.Icon>
                  <Item.Label>{f.path}</Item.Label>
                </Item>
              );
            })}
          </div>
        </GroupCollapsible>
      )}

      {editorPath && (
        <CodeEditor filePath={editorPath} onClose={() => setEditorPath(null)} />
      )}

      <GroupCollapsible label="Build Verification" count={taskOutput.buildSteps.length || undefined} defaultOpen className={styles.section}>
        {taskOutput.buildSteps.length > 0 ? (
          <div className={styles.liveOutputSection}>
            <div className={styles.activityList}>
              {taskOutput.buildSteps.map((step, i) => (
                <BuildStepItem key={i} step={step} active={i === taskOutput.buildSteps.length - 1} />
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.emptyVerification}>
            <Text variant="muted" size="sm">{emptyBuildMessage}</Text>
          </div>
        )}
      </GroupCollapsible>

      <GroupCollapsible label="Test Verification" count={taskOutput.testSteps.length || undefined} defaultOpen className={styles.section}>
        {taskOutput.testSteps.length > 0 ? (
          <div className={styles.liveOutputSection}>
            <div className={styles.activityList}>
              {taskOutput.testSteps.map((step, i) => (
                <TestStepItem key={i} step={step} active={i === taskOutput.testSteps.length - 1} />
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.emptyVerification}>
            <Text variant="muted" size="sm">{emptyTestMessage}</Text>
          </div>
        )}
      </GroupCollapsible>

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
            {isActive && streamBuf.length > 0 && (
              <Text variant="muted" size="xs" className={styles.streamProgress}>
                Streaming: {(streamBuf.length / 1024).toFixed(1)} KB received
              </Text>
            )}
          </div>
        </GroupCollapsible>
      )}
    </>
  );
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffSec = Math.floor((end - start) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function SessionPreview({ session }: { session: Session }) {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const sidekick = useSidekick();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .listAgents(projectId)
      .then((agents) => {
        const agent = agents.find((a) => a.agent_id === session.agent_id);
        if (!agent) return;
        return api.listSessionTasks(projectId, agent.agent_id, session.session_id);
      })
      .then((t) => { if (t) setTasks(t); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId, session.session_id, session.agent_id]);

  const contextPct = Math.round(session.context_usage_estimate * 100);

  return (
    <>
      <div className={styles.taskMeta}>
        <div className={styles.taskField}>
          <Text variant="muted" size="sm">Status</Text>
          <StatusBadge status={session.status} />
        </div>
        {session.user_id && (
          <div className={styles.taskField}>
            <Text variant="muted" size="sm">User</Text>
            <Text size="sm">{session.user_id.slice(0, 8)}</Text>
          </div>
        )}
        {session.model && (
          <div className={styles.taskField}>
            <Text variant="muted" size="sm">Model</Text>
            <Text size="sm">{formatModelName(session.model)}</Text>
          </div>
        )}
        <div className={styles.taskField}>
          <Text variant="muted" size="sm">Cost</Text>
          <Text size="sm">{formatCostFromTokens(session.total_input_tokens, session.total_output_tokens, session.model ?? undefined)}</Text>
        </div>
        <div className={styles.taskField}>
          <Text variant="muted" size="sm">Duration</Text>
          <Text size="sm">
            {formatDuration(session.started_at, session.ended_at)}
            {!session.ended_at && " (ongoing)"}
          </Text>
        </div>
        <div className={styles.taskField}>
          <Text variant="muted" size="sm">Context Usage</Text>
          <Text size="sm">{contextPct}%</Text>
        </div>
        <div className={styles.taskField}>
          <Text variant="muted" size="sm">Tokens Used</Text>
          <Text size="sm">
            {formatTokens(session.total_input_tokens + session.total_output_tokens)} total
            <Text variant="muted" size="sm" as="span"> ({formatTokens(session.total_input_tokens)} in / {formatTokens(session.total_output_tokens)} out)</Text>
          </Text>
        </div>
        <div className={styles.taskField}>
          <Text variant="muted" size="sm">Started</Text>
          <Text size="sm">{formatRelativeTime(session.started_at)}</Text>
        </div>
        {session.ended_at && (
          <div className={styles.taskField}>
            <Text variant="muted" size="sm">Ended</Text>
            <Text size="sm">{formatRelativeTime(session.ended_at)}</Text>
          </div>
        )}
      </div>

      {session.summary_of_previous_context && (
        <GroupCollapsible label="Context Summary" defaultOpen className={styles.section}>
          <div className={styles.notesContent}>
            <div className={styles.markdown}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {session.summary_of_previous_context}
              </ReactMarkdown>
            </div>
          </div>
        </GroupCollapsible>
      )}

      <GroupCollapsible
        label="Tasks"
        count={tasks.length}
        defaultOpen
        className={styles.section}
      >
        <div className={styles.fileOpsList}>
          {loading && <Text variant="muted" size="sm" style={{ padding: "0 var(--space-3)" }}>Loading...</Text>}
          {!loading && tasks.length === 0 && (
            <Text variant="muted" size="sm" style={{ padding: "0 var(--space-3)" }}>No tasks in this session</Text>
          )}
          {tasks.map((task) => (
            <Item
              key={task.task_id}
              onClick={() => sidekick.pushPreview({ kind: "task", task })}
              className={styles.fileOpItem}
            >
              <Item.Icon><TaskStatusIcon status={task.status} /></Item.Icon>
              <Item.Label>{task.title}</Item.Label>
            </Item>
          ))}
        </div>
      </GroupCollapsible>
    </>
  );
}

function previewTitle(item: PreviewItem): string {
  switch (item.kind) {
    case "spec": return item.spec.title;
    case "task": return item.task.title;
    case "session": return `Session ${item.session.session_id.slice(0, 8)}`;
  }
}

function useDisplayItem() {
  const { previewItem } = useSidekick();
  const lastItem = useRef<PreviewItem | null>(null);
  if (previewItem) lastItem.current = previewItem;
  return previewItem ?? lastItem.current;
}

export function PreviewHeader() {
  const { closePreview, canGoBack, goBackPreview } = useSidekick();
  const displayItem = useDisplayItem();

  if (!displayItem) return null;

  return (
    <div className={styles.previewHeader}>
      {canGoBack && (
        <Button variant="ghost" size="sm" iconOnly icon={<ArrowLeft size={14} />} onClick={goBackPreview} />
      )}
      <Text size="sm" className={styles.previewTitle} style={{ fontWeight: 600 }}>
        {previewTitle(displayItem)}
      </Text>
      {displayItem.kind === "task" && <RunTaskButton task={displayItem.task} />}
      <Button variant="ghost" size="sm" iconOnly icon={<X size={14} />} onClick={closePreview} />
    </div>
  );
}

export function PreviewContent() {
  const displayItem = useDisplayItem();
  const bodyRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const resetKey = displayItem
    ? displayItem.kind === "task" ? displayItem.task.task_id
    : displayItem.kind === "spec" ? displayItem.spec.spec_id
    : displayItem.kind === "session" ? displayItem.session.session_id
    : null
    : null;

  useEffect(() => {
    autoScrollRef.current = true;
  }, [resetKey]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const scrollIfNeeded = () => {
      if (autoScrollRef.current) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    };

    const onScroll = () => {
      const { scrollHeight, scrollTop, clientHeight } = el;
      autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
    };

    el.addEventListener("scroll", onScroll, { passive: true });

    const observer = new MutationObserver(scrollIfNeeded);
    observer.observe(el, { childList: true, subtree: true, characterData: true });

    scrollIfNeeded();

    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [resetKey]);

  return (
    <div ref={bodyRef} className={styles.previewBody}>
      {displayItem?.kind === "spec" && <SpecPreview spec={displayItem.spec} />}
      {displayItem?.kind === "task" && <TaskPreview task={displayItem.task} />}
      {displayItem?.kind === "session" && <SessionPreview session={displayItem.session} />}
    </div>
  );
}
