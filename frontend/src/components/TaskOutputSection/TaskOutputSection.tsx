import { GroupCollapsible } from "@cypher-asi/zui";
import { MessageBubble } from "../MessageBubble";
import { StreamingBubble } from "../StreamingBubble";
import {
  useStreamEvents,
  useIsStreaming,
  useStreamingText,
  useThinkingText,
  useThinkingDurationMs,
  useActiveToolCalls,
  useTimeline,
  useProgressText,
} from "../../hooks/stream/hooks";
import styles from "../Preview/Preview.module.css";

export interface TaskOutputSectionProps {
  isActive: boolean;
  streamKey: string;
}

export function TaskOutputSection({ isActive, streamKey }: TaskOutputSectionProps) {
  const events = useStreamEvents(streamKey);
  const isStreaming = useIsStreaming(streamKey);
  const streamingText = useStreamingText(streamKey);
  const thinkingText = useThinkingText(streamKey);
  const thinkingDurationMs = useThinkingDurationMs(streamKey);
  const activeToolCalls = useActiveToolCalls(streamKey);
  const timeline = useTimeline(streamKey);
  const progressText = useProgressText(streamKey);

  const hasLiveContent =
    isStreaming || !!streamingText || !!thinkingText || !!progressText || activeToolCalls.length > 0;
  const hasContent = events.length > 0 || hasLiveContent;

  if (!hasContent && !isActive) return null;

  return (
    <GroupCollapsible
      label={isActive ? "Live Output" : "Output"}
      defaultOpen
      className={styles.section}
    >
      <div className={styles.liveOutputSection}>
        {events.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {hasLiveContent && (
          <StreamingBubble
            isStreaming={isStreaming}
            text={streamingText}
            toolCalls={activeToolCalls}
            thinkingText={thinkingText}
            thinkingDurationMs={thinkingDurationMs}
            timeline={timeline}
            progressText={progressText}
          />
        )}
      </div>
    </GroupCollapsible>
  );
}
