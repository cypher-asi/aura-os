import { useLayoutEffect, useState, type RefObject } from "react";
import { ChevronRight } from "lucide-react";
import { useTaskStream } from "../../hooks/use-task-stream";
import {
  useIsStreaming,
  useIsWriting,
  useStreamingText,
  useThinkingText,
  useThinkingDurationMs,
  useActiveToolCalls,
  useTimeline,
  useProgressText,
} from "../../hooks/stream/hooks";
import { LLMStreamOutput } from "../ChatOutput";
import { CookingIndicator } from "../CookingIndicator";
import styles from "./TaskOutputPanel.module.css";

interface ActiveTaskStreamProps {
  taskId: string;
  title?: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
  isAutoFollowing?: boolean;
}

export function ActiveTaskStream({
  taskId,
  title,
  scrollRef,
  isAutoFollowing = true,
}: ActiveTaskStreamProps) {
  const { streamKey } = useTaskStream(taskId, true);
  const isStreaming = useIsStreaming(streamKey);
  const isWriting = useIsWriting(streamKey);
  const streamingText = useStreamingText(streamKey);
  const thinkingText = useThinkingText(streamKey);
  const thinkingDurationMs = useThinkingDurationMs(streamKey);
  const activeToolCalls = useActiveToolCalls(streamKey);
  const timeline = useTimeline(streamKey);
  const progressText = useProgressText(streamKey);

  const [collapsed, setCollapsed] = useState(false);

  const hasContent = isStreaming || !!streamingText || !!thinkingText || activeToolCalls.length > 0;

  // Pin to bottom when the tail grows. CSS `overflow-anchor: auto` on the
  // parent scroller (see TaskOutputPanel.module.css `.content`) handles
  // growth *above* the anchor natively; this effect covers growth *at* the
  // anchor (streaming tokens, new tool rows) by pushing scrollTop to the
  // fresh bottom synchronously during commit — before the browser paints
  // the intermediate "pushed up" state. Mirrors ChatMessageList's approach.
  useLayoutEffect(() => {
    if (!scrollRef || !isAutoFollowing || collapsed || !hasContent) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    scrollRef,
    isAutoFollowing,
    collapsed,
    hasContent,
    streamingText,
    thinkingText,
    activeToolCalls.length,
    progressText,
    timeline.length,
  ]);

  return (
    <div className={styles.taskSection}>
      <button
        type="button"
        className={styles.taskHeader}
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className={collapsed ? styles.taskChevron : styles.taskChevronExpanded}>
          <ChevronRight size={10} />
        </span>
        <span className={styles.taskDot} />
        <span className={styles.taskTitle}>{title || taskId}</span>
      </button>
      {!collapsed && (
        <div className={styles.taskBody}>
          {hasContent ? (
            <LLMStreamOutput
              isStreaming={isStreaming}
              text={streamingText}
              toolCalls={activeToolCalls}
              thinkingText={thinkingText}
              thinkingDurationMs={thinkingDurationMs}
              timeline={timeline}
              progressText={progressText}
              isWriting={isWriting}
              showPhaseIndicator={false}
            />
          ) : (
            <CookingIndicator label="Waiting for output…" />
          )}
        </div>
      )}
    </div>
  );
}
