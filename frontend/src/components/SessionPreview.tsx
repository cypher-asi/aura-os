import { useState, useEffect } from "react";
import { Text, GroupCollapsible, Item } from "@cypher-asi/zui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { api } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import { TaskStatusIcon } from "./TaskStatusIcon";
import { formatRelativeTime, formatTokens, formatModelName } from "../utils/format";
import { formatCostFromTokens, getCostEstimateLabel } from "../utils/pricing";
import { StatusBadge } from "./StatusBadge";
import type { Task, Session } from "../types";
import styles from "./Preview.module.css";

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

export function SessionPreview({ session }: { session: Session }) {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const sidekick = useSidekick();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestKey = projectId
    ? `${projectId}:${session.agent_instance_id}:${session.session_id}`
    : null;

  useEffect(() => {
    if (!projectId || !requestKey) return;
    let cancelled = false;

    api
      .listSessionTasks(projectId, session.agent_instance_id, session.session_id)
      .then((nextTasks) => {
        if (cancelled) return;
        setTasks(nextTasks);
        setLoadedKey(requestKey);
      })
      .catch((error) => {
        console.error(error);
        if (cancelled) return;
        setTasks([]);
        setLoadedKey(requestKey);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, requestKey, session.agent_instance_id, session.session_id]);

  const loading = !!requestKey && loadedKey !== requestKey;

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
        <div className={styles.taskField} title={getCostEstimateLabel()}>
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
