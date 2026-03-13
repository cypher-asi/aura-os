import { useRef, useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Sidebar, Button, Text } from "@cypher-asi/zui";
import { X, Sparkles, Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import { StatusBadge } from "./StatusBadge";
import { formatRelativeTime } from "../utils/format";
import type { PreviewItem } from "../context/SidekickContext";
import type { Sprint } from "../types";
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
      </div>
    </div>
  );
}

function SpecPreview({ spec }: { spec: import("../types").Spec }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {spec.markdown_contents}
      </ReactMarkdown>
    </div>
  );
}

function TaskPreview({ task }: { task: import("../types").Task }) {
  return (
    <>
      <div className={styles.taskMeta}>
        <Text variant="muted" size="sm" as="span">Status</Text>
        <span><StatusBadge status={task.status} /></span>
        <Text variant="muted" size="sm" as="span">Description</Text>
        <Text size="sm" as="span">{task.description || "—"}</Text>
        {task.execution_notes && (
          <>
            <Text variant="muted" size="sm" as="span">Exec Notes</Text>
            <Text size="sm" as="span">{task.execution_notes}</Text>
          </>
        )}
      </div>
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
  }
}

export function Preview() {
  const { previewItem, closePreview } = useSidekick();
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
      </div>
    </Sidebar>
  );
}
