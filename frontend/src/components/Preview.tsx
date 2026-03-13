import { useRef, useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Sidebar, Button, Text } from "@cypher-asi/zui";
import { X } from "lucide-react";
import { api } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import { StatusBadge } from "./StatusBadge";
import type { PreviewItem } from "../context/SidekickContext";
import type { Sprint } from "../types";
import styles from "./Preview.module.css";

function SprintPreview({ sprint }: { sprint: Sprint }) {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const [title, setTitle] = useState(sprint.title);
  const [prompt, setPrompt] = useState(sprint.prompt);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setTitle(sprint.title);
    setPrompt(sprint.prompt);
  }, [sprint.sprint_id, sprint.title, sprint.prompt]);

  const save = useCallback(
    (updates: { title?: string; prompt?: string }) => {
      if (!projectId) return;
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        api.updateSprint(projectId, sprint.sprint_id, updates).catch(console.error);
      }, 500);
    },
    [projectId, sprint.sprint_id],
  );

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  return (
    <div className={styles.sprintEditor}>
      <input
        className={styles.sprintTitleInput}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          save({ title: e.target.value });
        }}
        placeholder="Sprint title"
      />
      <textarea
        className={styles.sprintPromptArea}
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          save({ prompt: e.target.value });
        }}
        placeholder="Write your sprint document here..."
      />
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
            <Text size="sm" className={styles.previewTitle} style={{ fontWeight: 600 }}>
              {previewTitle(displayItem)}
            </Text>
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
