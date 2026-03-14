import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Sidebar, Button, Text, GroupCollapsible, Item } from "@cypher-asi/zui";
import { X, ArrowLeft, Sparkles, Loader2, FilePlus, FilePen, FileX, RotateCcw, Play, Check } from "lucide-react";
import { api } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import { useEventContext } from "../context/EventContext";
import { TaskStatusIcon } from "./TaskStatusIcon";
import { formatRelativeTime } from "../utils/format";
import { parseTaskStream } from "../utils/parse-task-stream";
import { deriveActivity } from "../utils/derive-activity";
import type { PreviewItem } from "../context/SidekickContext";
import type { Sprint, Task, Session } from "../types";
import { StatusBadge } from "./StatusBadge";
import styles from "./Preview.module.css";

function SprintPreview({ sprint }: { sprint: Sprint }) {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const sidekick = useSidekick();
  const [prompt, setPrompt] = useState(sprint.prompt);
  const [generatedAt, setGeneratedAt] = useState(sprint.generated_at);
  const [generating, setGenerating] = useState(false);
  const [tokenCount, setTokenCount] = useState<{ input: number; output: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const streamBufRef = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setPrompt(sprint.prompt);
    setGeneratedAt(sprint.generated_at);
  }, [sprint.sprint_id, sprint.prompt, sprint.generated_at]);

  const savePrompt = useCallback(
    (value: string) => {
      if (!projectId) return;
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        api.updateSprint(projectId, sprint.sprint_id, { prompt: value }).catch(console.error);
      }, 500);
    },
    [projectId, sprint.sprint_id],
  );

  const handleGenerate = useCallback(async () => {
    if (!projectId || generating) return;
    setGenerating(true);
    setTokenCount(null);

    const abort = new AbortController();
    abortRef.current = abort;
    streamBufRef.current = "";

    try {
      await api.generateSprintStream(
        projectId,
        sprint.sprint_id,
        {
          onDelta(text) {
            streamBufRef.current += text;
            setPrompt(streamBufRef.current);
            requestAnimationFrame(() => {
              const el = textareaRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
          },
          onGenerating(inputTokens, outputTokens) {
            setTokenCount({ input: inputTokens, output: outputTokens });
          },
          onDone(updated) {
            setPrompt(updated.prompt);
            setGeneratedAt(updated.generated_at);
            sidekick.updatePreviewSprint({
              sprint_id: sprint.sprint_id,
              title: updated.title,
              prompt: updated.prompt,
              generated_at: updated.generated_at,
            });
            sidekick.notifySprintUpdate(updated);
            setGenerating(false);
          },
          onError(message) {
            console.error("Sprint stream error:", message);
            setGenerating(false);
          },
        },
        abort.signal,
      );
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error("Failed to generate sprint", err);
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [projectId, sprint.sprint_id, generating, sidekick]);

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return (
    <div className={styles.sprintEditor}>
      <textarea
        ref={textareaRef}
        className={styles.sprintPromptArea}
        value={prompt}
        readOnly={generating}
        onChange={(e) => {
          const value = e.target.value;
          setPrompt(value);
          savePrompt(value);
          sidekick.updatePreviewSprint({ sprint_id: sprint.sprint_id, prompt: value });
          sidekick.notifySprintUpdate({ ...sprint, prompt: value });
        }}
        placeholder="Describe what this sprint should cover, then click Generate..."
      />
      <div className={styles.sprintFooter}>
        <Button
          variant="secondary"
          size="sm"
          className={styles.generateBtn}
          icon={generating ? <Loader2 size={14} className={styles.spinner} /> : <Sparkles size={14} />}
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? "Generating..." : "Generate"}
        </Button>
        {generating && tokenCount && (
          <Text variant="muted" size="sm" className={styles.tokenCount}>
            {tokenCount.output.toLocaleString()} tokens
          </Text>
        )}
        {!generating && generatedAt && (
          <Text variant="muted" size="sm" className={styles.lastGenerated}>
            Last generated: {formatRelativeTime(generatedAt)}
          </Text>
        )}
      </div>
    </div>
  );
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

function TaskPreview({ task }: { task: import("../types").Task }) {
  const { subscribe } = useEventContext();
  const ctx = useProjectContext();
  const sidekick = useSidekick();
  const projectId = ctx?.project.project_id;
  const [streamBuf, setStreamBuf] = useState("");
  const [liveFileOps, setLiveFileOps] = useState<{ op: string; path: string }[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [runningTask, setRunningTask] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const effectiveStatus = liveStatus ?? task.status;
  const isActive = effectiveStatus === "in_progress";

  useEffect(() => {
    setLiveStatus(null);
    setRunningTask(false);
  }, [task.task_id]);

  useEffect(() => {
    const unsubs = [
      subscribe("task_started", (e) => {
        if (e.task_id !== task.task_id) return;
        setLiveStatus("in_progress");
        setRunningTask(false);
      }),
      subscribe("task_completed", (e) => {
        if (e.task_id !== task.task_id) return;
        setLiveStatus("done");
      }),
      subscribe("task_failed", (e) => {
        if (e.task_id !== task.task_id) return;
        setLiveStatus("failed");
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [task.task_id, subscribe]);

  useEffect(() => {
    setStreamBuf("");
    setLiveFileOps([]);
  }, [task.task_id]);

  useEffect(() => {
    if (!isActive) return;
    setStreamBuf("");
    setLiveFileOps([]);
    const unsubs = [
      subscribe("task_output_delta", (e) => {
        if (e.task_id !== task.task_id) return;
        setStreamBuf((prev) => prev + (e.delta ?? ""));
      }),
      subscribe("file_ops_applied", (e) => {
        if (e.task_id !== task.task_id || !e.files) return;
        setLiveFileOps(e.files);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [task.task_id, isActive, subscribe]);

  useEffect(() => {
    if (autoScrollRef.current && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamBuf]);

  const handleStreamScroll = useCallback(() => {
    const el = streamRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const parsed = useMemo(() => (isActive && streamBuf ? parseTaskStream(streamBuf) : null), [isActive, streamBuf]);

  const fileOps = isActive
    ? (liveFileOps.length > 0 ? liveFileOps : parsed?.fileOps ?? [])
    : (task.files_changed ?? []);

  const notes = isActive
    ? (parsed?.notes ?? (streamBuf ? null : null))
    : task.execution_notes;

  const showNotes = isActive ? (parsed?.notes != null) : !!task.execution_notes;

  const activity = useMemo(
    () => (isActive ? deriveActivity(streamBuf) : []),
    [isActive, streamBuf],
  );
  const showLiveOutput = isActive && activity.length > 0;

  const handleRetry = useCallback(async () => {
    if (!projectId || retrying) return;
    setRetrying(true);
    try {
      await api.retryTask(projectId, task.task_id);
    } catch (err) {
      console.error("Retry failed:", err);
    } finally {
      setRetrying(false);
    }
  }, [projectId, task.task_id, retrying]);

  const handleRunTask = useCallback(async () => {
    if (!projectId || runningTask) return;
    setRunningTask(true);
    try {
      await api.runTask(projectId, task.task_id);
    } catch (err) {
      console.error("Run task failed:", err);
      setRunningTask(false);
    }
  }, [projectId, task.task_id, runningTask]);

  const handleViewSession = useCallback(async () => {
    if (!projectId || !task.session_id || !task.assigned_agent_id) return;
    try {
      const session = await api.getSession(projectId, task.assigned_agent_id, task.session_id);
      sidekick.pushPreview({ kind: "session", session });
    } catch (err) {
      console.error("Failed to load session:", err);
    }
  }, [projectId, task.session_id, task.assigned_agent_id, sidekick]);

  return (
    <>
      <div className={styles.taskMeta}>
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Status</span>
          <span className={styles.statusRow}>
            <TaskStatusIcon status={effectiveStatus} />
            <Text size="sm">{effectiveStatus.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</Text>
            {effectiveStatus === "ready" && (
              <Button
                variant="secondary"
                size="sm"
                icon={runningTask ? <Loader2 size={14} className={styles.spinner} /> : <Play size={14} />}
                onClick={handleRunTask}
                disabled={runningTask}
              >
                {runningTask ? "Running..." : "Run"}
              </Button>
            )}
            {effectiveStatus === "failed" && (
              <Button
                variant="secondary"
                size="sm"
                icon={<RotateCcw size={14} />}
                onClick={handleRetry}
                disabled={retrying}
              >
                {retrying ? "Retrying..." : "Retry"}
              </Button>
            )}
          </span>
        </div>
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Description</span>
          {task.description ? (
            <div className={styles.markdown}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {task.description}
              </ReactMarkdown>
            </div>
          ) : (
            <Text size="sm">—</Text>
          )}
        </div>
        {task.session_id && (
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
              {task.session_id!.slice(0, 8)}
            </button>
          </div>
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
                  onClick={() => {
                    api.openPath(fullPath).catch(console.error);
                  }}
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

      {showNotes && (
        <GroupCollapsible label="Notes" defaultOpen className={styles.section}>
          <div className={styles.notesContent}>
            <div className={styles.markdown}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {notes || ""}
              </ReactMarkdown>
            </div>
          </div>
        </GroupCollapsible>
      )}

      {showLiveOutput && (
        <GroupCollapsible label="Live Output" defaultOpen className={styles.section}>
          <div className={styles.liveOutputSection}>
            <div ref={streamRef} className={styles.activityList} onScroll={handleStreamScroll}>
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
            {(session.total_input_tokens + session.total_output_tokens).toLocaleString()} total
            <Text variant="muted" size="sm" as="span"> ({session.total_input_tokens.toLocaleString()} in / {session.total_output_tokens.toLocaleString()} out)</Text>
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

function SprintHeaderTitle({ sprint }: { sprint: Sprint }) {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const sidekick = useSidekick();
  const [title, setTitle] = useState(sprint.title);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setTitle(sprint.title);
  }, [sprint.sprint_id, sprint.title]);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTitle(value);
    sidekick.updatePreviewSprint({ sprint_id: sprint.sprint_id, title: value });
    sidekick.notifySprintUpdate({ ...sprint, title: value });
    clearTimeout(debounceRef.current);
    if (projectId) {
      debounceRef.current = setTimeout(() => {
        api.updateSprint(projectId, sprint.sprint_id, { title: value }).catch(console.error);
      }, 500);
    }
  };

  return (
    <input
      className={styles.headerTitleInput}
      value={title}
      onChange={handleChange}
      placeholder="Sprint title"
    />
  );
}

function previewTitle(item: PreviewItem): string {
  switch (item.kind) {
    case "sprint": return item.sprint.title;
    case "spec": return item.spec.title;
    case "task": return item.task.title;
    case "session": return `Session ${item.session.session_id.slice(0, 8)}`;
  }
}

export function Preview() {
  const { previewItem, closePreview, canGoBack, goBackPreview } = useSidekick();
  const lastItem = useRef<PreviewItem | null>(null);

  if (previewItem) lastItem.current = previewItem;
  const displayItem = previewItem ?? lastItem.current;

  return (
    <Sidebar
      className={styles.previewPanel}
      resizable
      resizePosition="left"
      defaultWidth={320}
      minWidth={200}
      maxWidth={600}
      storageKey="aura-preview"
      collapsed={!previewItem}
      header={
        displayItem ? (
          <div className={styles.previewHeader}>
            {canGoBack && (
              <Button variant="ghost" size="sm" iconOnly icon={<ArrowLeft size={14} />} onClick={goBackPreview} />
            )}
            {displayItem.kind === "sprint" ? (
              <SprintHeaderTitle sprint={displayItem.sprint} />
            ) : (
              <Text size="sm" className={styles.previewTitle} style={{ fontWeight: 600 }}>
                {previewTitle(displayItem)}
              </Text>
            )}
            <Button variant="ghost" size="sm" iconOnly icon={<X size={14} />} onClick={closePreview} />
          </div>
        ) : undefined
      }
    >
      <div className={styles.previewBody}>
        {displayItem?.kind === "sprint" && <SprintPreview sprint={displayItem.sprint} />}
        {displayItem?.kind === "spec" && <SpecPreview spec={displayItem.spec} />}
        {displayItem?.kind === "task" && <TaskPreview task={displayItem.task} />}
        {displayItem?.kind === "session" && <SessionPreview session={displayItem.session} />}
      </div>
    </Sidebar>
  );
}
