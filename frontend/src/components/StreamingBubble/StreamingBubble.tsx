import type { ToolCallEntry, TimelineItem } from "../../types/stream";
import { stripEmojis, normalizeMidSentenceBreaks } from "../../utils/text-normalize";
import { getStreamingPhaseLabel } from "../../utils/streaming";
import { CookingIndicator } from "../CookingIndicator";
import { SegmentedContent } from "../SegmentedContent";
import { ThinkingRow } from "../ThinkingRow";
import { ToolCallsList } from "../ToolRow";
import { ActivityTimeline } from "../ActivityTimeline";
import styles from "../MessageBubble/MessageBubble.module.css";

interface StreamingBubbleProps {
  text: string;
  toolCalls?: ToolCallEntry[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  timeline?: TimelineItem[];
  progressText?: string;
}

function StreamingIndicator({
  text,
  thinkingText,
  toolCalls,
  progressText,
}: {
  text: string;
  thinkingText?: string;
  toolCalls?: ToolCallEntry[];
  progressText?: string;
}) {
  const label = getStreamingPhaseLabel({
    streamingText: text,
    thinkingText,
    toolCalls: toolCalls ?? [],
    progressText,
  });

  return <CookingIndicator label={label ?? "Cooking..."} />;
}

export function StreamingBubble({ text, toolCalls, thinkingText, thinkingDurationMs, timeline, progressText }: StreamingBubbleProps) {
  const hasTimeline = timeline && timeline.length > 0;
  const isThinking = Boolean(thinkingText) && !text;
  return (
    <div className={`${styles.message} ${styles.messageAssistant}`}>
      <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
        <div className={styles.markdown}>
          {hasTimeline ? (
            <ActivityTimeline
              timeline={timeline}
              thinkingText={thinkingText}
              thinkingDurationMs={thinkingDurationMs}
              toolCalls={toolCalls}
              isStreaming
            />
          ) : (
            <>
              {thinkingText && (
                <ThinkingRow
                  text={thinkingText}
                  isStreaming={isThinking}
                  durationMs={thinkingDurationMs}
                />
              )}
              {toolCalls && toolCalls.length > 0 && (
                <ToolCallsList entries={toolCalls} />
              )}
              {text && (
                <SegmentedContent content={normalizeMidSentenceBreaks(stripEmojis(text))} />
              )}
            </>
          )}
          <StreamingIndicator text={text} thinkingText={thinkingText} toolCalls={toolCalls} progressText={progressText} />
        </div>
      </div>
    </div>
  );
}
