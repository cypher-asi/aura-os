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

  const isThinkingPhaseActive =
    isStreaming && !timeline.some((i) => i.kind !== "thinking");

  return (
    <div className={styles.timeline}>
      {timeline.map((item) => {
        if (item.kind === "thinking") {
          if (!thinkingText) return null;
          return (
            <div key={item.id} className={styles.timelineItem}>
              <ThinkingRow
                text={thinkingText}
                isStreaming={isThinkingPhaseActive}
                durationMs={thinkingDurationMs}
              />
            </div>
          );
        }

        if (item.kind === "tool") {
          const entry = toolCallMap.get(item.toolCallId);
          if (!entry) return null;
          return (
            <div key={item.id} className={styles.timelineItem}>
              <ToolCallBlock entry={entry} defaultExpanded={entry.pending} />
            </div>
          );
        }

        const normalized = normalizeMidSentenceBreaks(stripEmojis(item.content));
        return (
          <div key={item.id} className={styles.timelineItem}>
            <SegmentedContent content={normalized} />
          </div>
        );
      })}
    </div>
  );
}
