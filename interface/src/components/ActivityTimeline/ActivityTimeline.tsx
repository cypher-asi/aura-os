import { useMemo, type ReactNode } from "react";
import type { TimelineItem, ToolCallEntry } from "../../types/stream";
import {
  stripEmojis,
  normalizeMidSentenceBreaks,
  flattenListIndentation,
  normalizeLooseStrongEmphasis,
} from "../../utils/text-normalize";
import { ThinkingRow } from "../ThinkingRow";
import { ToolCallBlock } from "../ToolRow";
import { SegmentedContent } from "../SegmentedContent";
import styles from "./ActivityTimeline.module.css";

// Tools whose body holds useful live-streaming content worth showing
// automatically (spec draft, file diff/contents, command output). Every
// other tool -- reads, lists, deletes, transitions, task CRUD, etc. --
// stays collapsed by default so finalized bubbles read as a tight
// checklist instead of a wall of JSON.
const AUTO_EXPAND_TOOLS = new Set([
  "create_spec",
  "update_spec",
  "write_file",
  "edit_file",
  "run_command",
]);

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

  // Build flat list of rendered items with their kind
  const items: RenderedItem[] = [];
  for (const item of timeline) {
    if (item.kind === "thinking") {
      if (!thinkingText) continue;
      items.push({
        key: item.id,
        kind: "thinking",
        node: (
          <ThinkingRow
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
      // Auto-expand only tools with rich live-streaming content (see
      // AUTO_EXPAND_TOOLS). Reads, lists, deletes and task CRUD stay
      // collapsed so finalized bubbles don't dump raw JSON on the reader.
      // Historical bubbles (defaultActivitiesExpanded=false,
      // entry.pending=false) always start collapsed; just-finalized
      // bubbles mirror the StreamingBubble's state for the preview tools.
      const isAutoExpand = AUTO_EXPAND_TOOLS.has(entry.name);
      const defaultToolExpanded = defaultActivitiesExpanded
        ? isAutoExpand
        : entry.pending && isAutoExpand;
      items.push({
        key: item.id,
        kind: "tool",
        node: (
          <ToolCallBlock
            entry={entry}
            defaultExpanded={defaultToolExpanded}
          />
        ),
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

  // Group consecutive tool items together
  const groups: ReactNode[] = [];
  let i = 0;
  while (i < items.length) {
    const current = items[i];
    if (current.kind === "tool") {
      // Collect consecutive tools
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
