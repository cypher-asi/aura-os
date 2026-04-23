import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Button, Text } from "@cypher-asi/zui";
import { RotateCcw } from "lucide-react";
import { TaskStatusIcon } from "../TaskStatusIcon";
import { Avatar } from "../Avatar";
import { useAvatarState } from "../../hooks/use-avatar-state";
import { useProjectActions } from "../../stores/project-action-store";
import { toBullets, formatTokens, formatRelativeTime } from "../../utils/format";
import type { Task, AgentInstance } from "../../types";
import styles from "../Preview/Preview.module.css";

function extractErrorMessage(raw: string): string {
  const jsonMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
  if (jsonMatch) return jsonMatch[1];
  const prefixMatch = raw.match(/^[\w\s]+error:\s*(.+)/i);
  if (prefixMatch) return prefixMatch[1];
  return raw;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function AgentAvatar({ agent }: { agent: AgentInstance }) {
  const { status, isLocal } = useAvatarState(agent.agent_instance_id);
  return (
    <Avatar
      avatarUrl={agent.icon ?? undefined}
      name={agent.name}
      type="agent"
      size={16}
      status={status}
      isLocal={isLocal}
    />
  );
}

export interface TaskMetaSectionProps {
  task: Task;
  effectiveStatus: string;
  effectiveSessionId: string | null;
  isActive: boolean;
  elapsed: number;
  failReason: string | null;
  syncWarning: string | null;
  agentInstance: AgentInstance | null;
  completedByAgent: AgentInstance | null;
  retrying: boolean;
  onRetry: () => void;
  onViewSession: () => void;
}

export function TaskMetaSection({
  task,
  effectiveStatus,
  effectiveSessionId,
  isActive,
  elapsed,
  failReason,
  syncWarning,
  agentInstance,
  completedByAgent,
  retrying,
  onRetry,
  onViewSession,
}: TaskMetaSectionProps) {
  const ctx = useProjectActions();
  const specs = ctx?.initialSpecs;
  const allTasks = ctx?.initialTasks;
  const specTitle = specs?.find((s) => s.spec_id === task.spec_id)?.title;
  const parentTitle = task.parent_task_id
    ? allTasks?.find((t) => t.task_id === task.parent_task_id)?.title
    : null;
  const depTitles = task.dependency_ids.length > 0
    ? task.dependency_ids.map((id) => allTasks?.find((t) => t.task_id === id)?.title ?? id.slice(0, 8))
    : null;

  return (
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
              onClick={onRetry}
              disabled={retrying}
            />
          )}
        </span>
        {effectiveStatus === "failed" && (failReason || task.execution_notes) && (
          <Text size="xs" className={styles.failReason}>{extractErrorMessage(failReason || task.execution_notes)}</Text>
        )}
        {effectiveStatus === "done" && syncWarning && (
          <Text size="xs" className={styles.failReason}>{extractErrorMessage(syncWarning)}</Text>
        )}
      </div>
      <div className={styles.taskField}>
        <span className={styles.fieldLabel}>Assigned to</span>
        {agentInstance ? (
          <span className={styles.agentInline}>
            <AgentAvatar agent={agentInstance} />
            <Text size="sm">{agentInstance.name}</Text>
          </span>
        ) : (
          <Text size="sm" variant="muted">Unassigned</Text>
        )}
      </div>
      {completedByAgent && (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Completed by</span>
          <span className={styles.agentInline}>
            <AgentAvatar agent={completedByAgent} />
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
      {specTitle && (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Spec</span>
          <Text size="sm">{specTitle}</Text>
        </div>
      )}
      {typeof task.order_index === "number" && (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Order</span>
          <Text size="sm">{task.order_index}</Text>
        </div>
      )}
      {depTitles && depTitles.length > 0 && (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Dependencies ({depTitles.length})</span>
          <Text size="sm">{depTitles.join(", ")}</Text>
        </div>
      )}
      {parentTitle && (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Parent task</span>
          <Text size="sm">{parentTitle}</Text>
        </div>
      )}
      {effectiveSessionId && (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Session</span>
          <button
            onClick={onViewSession}
            className={styles.sessionLink}
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
          <Text size="sm">{task.model}</Text>
        </div>
      )}
      {(task.total_input_tokens > 0 || task.total_output_tokens > 0) && (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Tokens</span>
          <Text size="sm">
            {formatTokens(task.total_input_tokens + task.total_output_tokens)} total
            <Text variant="muted" size="sm" as="span"> ({formatTokens(task.total_input_tokens)} in / {formatTokens(task.total_output_tokens)} out)</Text>
          </Text>
        </div>
      )}
      {task.created_at && (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Created</span>
          <Text size="sm">{formatRelativeTime(task.created_at)}</Text>
        </div>
      )}
      {task.updated_at && task.updated_at !== task.created_at && (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Updated</span>
          <Text size="sm">{formatRelativeTime(task.updated_at)}</Text>
        </div>
      )}
    </div>
  );
}
