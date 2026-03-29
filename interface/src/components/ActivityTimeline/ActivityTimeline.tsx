import { useMemo } from "react";
import type { TimelineItem, ToolCallEntry } from "../../types/stream";
import { stripEmojis, normalizeMidSentenceBreaks } from "../../utils/text-normalize";
import { ThinkingRow } from "../ThinkingRow";
import { ToolCallBlock } from "../ToolRow";
import { SegmentedContent } from "../SegmentedContent";
import styles from "./ActivityTimeline.module.css";

interface ActivityTimelineProps {
  timeline: TimelineItem[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  toolCalls?: ToolCallEntry[];
  isStreaming: boolean;
}

export function ActivityTimeline({
  timeline,
  thinkingText,
  thinkingDurationMs,
  toolCalls,
  isStreaming,
}: ActivityTimelineProps) {
  const toolCallMap = useMemo(() => {
    const map = new Map<string, ToolCallEntry>();
    if (toolCalls) {
      for (const tc of toolCalls) map.set(tc.id, tc);
    }
    return map;
  }, [toolCalls]);

  return (
    <div className={styles.timeline}>
      {timeline.map((item) => {
        if (item.kind === "thinking") {
          if (!thinkingText) return null;
          return (
            <div key={item.id}>
              <ThinkingRow
                text={thinkingText}
                isStreaming={isStreaming}
                durationMs={thinkingDurationMs}
              />
            </div>
          );
        }

        if (item.kind === "tool") {
          const entry = toolCallMap.get(item.toolCallId);
          if (!entry) return null;
          return (
            <div key={item.id}>
              <ToolCallBlock entry={entry} defaultExpanded={entry.pending} />
            </div>
          );
        }

        const normalized = normalizeMidSentenceBreaks(stripEmojis(item.content));
        return (
          <div key={item.id}>
            <SegmentedContent content={normalized} isStreaming={isStreaming} />
          </div>
        );
      })}
    </div>
  );
}
