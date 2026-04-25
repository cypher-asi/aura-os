import { Fragment, useMemo, type ReactNode } from "react";
import type { TimelineItem, ToolCallEntry } from "../../shared/types/stream";
import {
  stripEmojis,
  normalizeMidSentenceBreaks,
  flattenListIndentation,
  normalizeLooseStrongEmphasis,
} from "../../shared/utils/text-normalize";
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

  // Consolidate contiguous `thinking` timeline entries into a single rendered
  // ThinkingBlock to avoid duplicate blocks when the stream briefly toggles
  // between thinking states. We walk the timeline twice: first to build a
  // merged list, then to apply the per-kind render rules below.
  const mergedTimeline: TimelineItem[] = [];
  for (const item of timeline) {
    const prev = mergedTimeline[mergedTimeline.length - 1];
    if (
      item.kind === "thinking" &&
      prev &&
      prev.kind === "thinking"
    ) {
      const mergedText = (prev.text ?? "") + (item.text ?? "");
      mergedTimeline[mergedTimeline.length - 1] = {
        ...prev,
        text: mergedText || undefined,
      };
      continue;
    }
    mergedTimeline.push(item);
  }

  const items: RenderedItem[] = [];
  for (const item of mergedTimeline) {
    if (item.kind === "thinking") {
      // Prefer per-segment text (set by handleThinkingDelta) so that when
      // multiple thinking runs occur within one turn each block shows only
      // the text that actually belongs to it. Fall back to the global
      // `thinkingText` for historical messages that predate per-segment text.
      const segmentText = item.text ?? thinkingText;
      if (!segmentText) continue;
      items.push({
        key: item.id,
        kind: "thinking",
        node: (
          <ThinkingBlock
            text={segmentText}
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
            <Fragment key={t.key}>{t.node}</Fragment>
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
