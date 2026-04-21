import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTaskStream } from "../../hooks/use-task-stream";
import {
  useIsStreaming,
  useStreamingText,
  useThinkingText,
  useThinkingDurationMs,
  useActiveToolCalls,
  useTimeline,
  useProgressText,
} from "../../hooks/stream/hooks";
import { LLMStreamOutput } from "../LLMOutput";
import { CookingIndicator } from "../CookingIndicator";
import styles from "./TaskOutputPanel.module.css";

interface ActiveTaskStreamProps {
  taskId: string;
  title?: string;
}

export function ActiveTaskStream({ taskId, title }: ActiveTaskStreamProps) {
  const { streamKey } = useTaskStream(taskId, true);
  const isStreaming = useIsStreaming(streamKey);
  const streamingText = useStreamingText(streamKey);
  const thinkingText = useThinkingText(streamKey);
  const thinkingDurationMs = useThinkingDurationMs(streamKey);
  const activeToolCalls = useActiveToolCalls(streamKey);
  const timeline = useTimeline(streamKey);
  const progressText = useProgressText(streamKey);

  const [collapsed, setCollapsed] = useState(false);

  const hasContent = isStreaming || !!streamingText || !!thinkingText || activeToolCalls.length > 0;

  return (
    <div className={styles.taskSection}>
      <button
        type="button"
        className={styles.taskHeader}
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className={collapsed ? styles.taskChevron : styles.taskChevronExpanded}>
          <ChevronRight size={10} />
        </span>
        <span className={styles.taskDot} />
        <span className={styles.taskTitle}>{title || taskId}</span>
      </button>
      {!collapsed && (
        <div className={styles.taskBody}>
          {hasContent ? (
            <LLMStreamOutput
              isStreaming={isStreaming}
              text={streamingText}
              toolCalls={activeToolCalls}
              thinkingText={thinkingText}
              thinkingDurationMs={thinkingDurationMs}
              timeline={timeline}
              progressText={progressText}
            />
          ) : (
            <CookingIndicator label="Waiting for output…" />
          )}
        </div>
      )}
    </div>
  );
}
