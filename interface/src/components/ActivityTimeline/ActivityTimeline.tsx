import { useMemo, type ReactNode } from "react";
import type { TimelineItem, ToolCallEntry } from "../../types/stream";
import {
  stripEmojis,
  normalizeMidSentenceBreaks,
  flattenListIndentation,
  normalizeLooseStrongEmphasis,
} from "../../utils/text-normalize";
import { ThinkingBlock, isAutoExpandedTool, renderToolBlock } from "../Block";
import { SegmentedContent } from "../SegmentedContent";
import styles from "./ActivityTimeline.module.css";

interface ActivityTimelineProps {
  timeline: TimelineItem[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  toolCalls?: ToolCallEntry[];
  isStreaming: boolean;
  defaultThinkingExpanded?: boolean;
  defaultActivitiesExpanded?: boolean;
}

interface RenderedItem {
  key: string;
  kind: string;
  node: ReactNode;
}

export function ActivityTimeline({
  timeline,
  thinkingText,
  thinkingDurationMs,
  toolCalls,
  isStreaming,
  defaultThinkingExpanded,
  defaultActivitiesExpanded,
}: ActivityTimelineProps) {
  const toolCallMap = useMemo(() => {
    const map = new Map<string, ToolCallEntry>();
    if (toolCalls) {
      for (const tc of toolCalls) map.set(tc.id, tc);
    }
    return map;
  }, [toolCalls]);

  const items: RenderedItem[] = [];
  for (const item of timeline) {
    if (item.kind === "thinking") {
      if (!thinkingText) continue;
      items.push({
        key: item.id,
        kind: "thinking",
        node: (
          <ThinkingBlock
            text={thinkingText}
            isStreaming={isStreaming}
            durationMs={thinkingDurationMs}
            defaultExpanded={defaultThinkingExpanded}
          />
        ),
      });
    } else if (item.kind === "tool") {
      const entry = toolCallMap.get(item.toolCallId);
      if (!entry) continue;
      // Just-finalized bubbles (defaultActivitiesExpanded=true) mirror the
      // StreamingBubble's state so the tools with rich live previews stay
      // visible. Historical bubbles (false) and reads/lists/deletes stay
      // collapsed so the turn reads as a tight checklist.
      const auto = isAutoExpandedTool(entry.name);
      const defaultToolExpanded = defaultActivitiesExpanded
        ? auto
        : entry.pending && auto;
      items.push({
        key: item.id,
        kind: "tool",
        node: renderToolBlock(entry, defaultToolExpanded),
      });
    } else {
      const normalized = normalizeLooseStrongEmphasis(
        flattenListIndentation(normalizeMidSentenceBreaks(stripEmojis(item.content))),
      );
      items.push({
        key: item.id,
        kind: "text",
        node: <SegmentedContent content={normalized} isStreaming={isStreaming} />,
      });
    }
  }

  const groups: ReactNode[] = [];
  let i = 0;
  while (i < items.length) {
    const current = items[i];
    if (current.kind === "tool") {
      const toolItems: RenderedItem[] = [];
      while (i < items.length && items[i].kind === "tool") {
        toolItems.push(items[i]);
        i++;
      }
      groups.push(
        <div key={`toolgroup-${toolItems[0].key}`} className={styles.toolGroup}>
          {toolItems.map((t) => (
            <div key={t.key}>{t.node}</div>
          ))}
        </div>,
      );
    } else {
      groups.push(
        <div key={current.key} data-kind={current.kind}>
          {current.node}
        </div>,
      );
      i++;
    }
  }

  return <div className={styles.timeline}>{groups}</div>;
}
