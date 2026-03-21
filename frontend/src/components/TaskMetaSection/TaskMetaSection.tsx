import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Button, Text } from "@cypher-asi/zui";
import { RotateCcw } from "lucide-react";
import { TaskStatusIcon } from "../TaskStatusIcon";
import { toBullets, formatTokens, formatModelName } from "../../utils/format";
import { formatCostFromTokens, getCostEstimateLabel } from "../../utils/pricing";
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

export interface TaskMetaSectionProps {
  task: Task;
  effectiveStatus: string;
  effectiveSessionId: string | null;
  isActive: boolean;
  elapsed: number;
  failReason: string | null;
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
  agentInstance,
  completedByAgent,
  retrying,
  onRetry,
  onViewSession,
}: TaskMetaSectionProps) {
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
      </div>
      {agentInstance && (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Assigned to</span>
          <span className={styles.agentInline}>
            {agentInstance.icon && (
              <img src={agentInstance.icon} alt="" className={styles.agentAvatar} />
            )}
            <Text size="sm">{agentInstance.name}</Text>
          </span>
        </div>
      )}
      {completedByAgent && (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Completed by</span>
          <span className={styles.agentInline}>
            {completedByAgent.icon && (
              <img src={completedByAgent.icon} alt="" className={styles.agentAvatar} />
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
  );
}
