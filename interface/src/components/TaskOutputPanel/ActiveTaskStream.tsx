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
import { StreamingBubble } from "../StreamingBubble";
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

  const hasContent = isStreaming || !!streamingText || !!thinkingText || activeToolCalls.length > 0;

  return (
    <div className={styles.taskSection}>
      <div className={styles.taskHeader}>
        <span className={styles.taskDot} />
        <span className={styles.taskTitle}>{title || taskId}</span>
      </div>
      <div className={styles.taskBody}>
        {hasContent ? (
          <StreamingBubble
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
    </div>
  );
}
