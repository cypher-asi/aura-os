import type { ToolCallEntry, TimelineItem } from "../../types/stream";
import { LLMStreamOutput } from "../LLMOutput";
import styles from "../MessageBubble/MessageBubble.module.css";

interface StreamingBubbleProps {
  isStreaming: boolean;
  text: string;
  toolCalls?: ToolCallEntry[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  timeline?: TimelineItem[];
  progressText?: string;
}

export function StreamingBubble({
  isStreaming,
  text,
  toolCalls,
  thinkingText,
  thinkingDurationMs,
  timeline,
  progressText,
}: StreamingBubbleProps) {
  return (
    <div className={`${styles.message} ${styles.messageAssistant}`}>
      <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
        <LLMStreamOutput
          isStreaming={isStreaming}
          text={text}
          toolCalls={toolCalls}
          thinkingText={thinkingText}
          thinkingDurationMs={thinkingDurationMs}
          timeline={timeline}
          progressText={progressText}
        />
      </div>
    </div>
  );
}
