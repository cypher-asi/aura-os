import { useMemo } from "react";
import type { ToolCallEntry, TimelineItem } from "../../types/stream";
import { getStreamingPhaseLabel } from "../../utils/streaming";
import { CookingIndicator } from "../CookingIndicator";
import { ActivityTimeline } from "../ActivityTimeline";
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

function StreamingIndicator({
  isStreaming,
  text,
  thinkingText,
  toolCalls,
  progressText,
}: {
  isStreaming: boolean;
  text: string;
  thinkingText?: string;
  toolCalls?: ToolCallEntry[];
  progressText?: string;
}) {
  if (!isStreaming) return null;
  const label = getStreamingPhaseLabel({
    streamingText: text,
    thinkingText,
    toolCalls: toolCalls ?? [],
    progressText,
  });

  if (!label) return null;
  return <CookingIndicator label={label} />;
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
  const timelineForRender = useMemo<TimelineItem[]>(() => {
    if (timeline && timeline.length > 0) return timeline;

    const synthetic: TimelineItem[] = [];
    if (thinkingText) synthetic.push({ kind: "thinking", id: "live-thinking" });
    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        synthetic.push({ kind: "tool", toolCallId: tc.id, id: `live-tool-${tc.id}` });
      }
    }
    if (text) synthetic.push({ kind: "text", content: text, id: "live-text" });
    return synthetic;
  }, [timeline, thinkingText, toolCalls, text]);

  return (
    <div className={`${styles.message} ${styles.messageAssistant}`}>
      <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
        <div className={styles.markdown}>
          <ActivityTimeline
            timeline={timelineForRender}
            thinkingText={thinkingText}
            thinkingDurationMs={thinkingDurationMs}
            toolCalls={toolCalls}
            isStreaming={isStreaming}
          />
          <StreamingIndicator
            isStreaming={isStreaming}
            text={text}
            thinkingText={thinkingText}
            toolCalls={toolCalls}
            progressText={progressText}
          />
        </div>
      </div>
    </div>
  );
}
