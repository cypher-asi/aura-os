import { useShallow } from "zustand/react/shallow";
import { CookingIndicator } from "../CookingIndicator";
import { useStreamStore } from "../../hooks/stream/store";
import { getStreamingPhaseLabel } from "../../utils/streaming";
import type { ToolCallEntry } from "../../shared/types/stream";
import styles from "./ChatPanel.module.css";

const EMPTY_TOOL_CALLS: ToolCallEntry[] = [];

interface ChatStreamingIndicatorProps {
  streamKey: string;
}

/**
 * Pins the streaming phase indicator ("Cooking...", "Thinking...", etc.)
 * absolutely over the empty zone above the input bar so that phase
 * transitions never reflow the chat content. The inline indicator inside
 * `StreamingBubble` is suppressed in this chat context via
 * `showPhaseIndicator={false}`.
 */
export function ChatStreamingIndicator({ streamKey }: ChatStreamingIndicatorProps) {
  const { isStreaming, isWriting, streamingText, thinkingText, toolCalls, progressText } = useStreamStore(
    useShallow((state) => ({
      isStreaming: state.entries[streamKey]?.isStreaming ?? false,
      isWriting: state.entries[streamKey]?.isWriting ?? false,
      streamingText: state.entries[streamKey]?.streamingText ?? "",
      thinkingText: state.entries[streamKey]?.thinkingText ?? "",
      toolCalls: state.entries[streamKey]?.activeToolCalls ?? EMPTY_TOOL_CALLS,
      progressText: state.entries[streamKey]?.progressText ?? "",
    })),
  );

  const nowStreaming =
    isStreaming || !!streamingText || !!thinkingText || toolCalls.length > 0;

  if (!nowStreaming) {
    return null;
  }

  const label = getStreamingPhaseLabel({
    streamingText,
    thinkingText,
    toolCalls,
    progressText,
    isWriting,
  });

  return (
    <div className={styles.pinnedStreamingIndicator} aria-live="polite">
      <div className={styles.pinnedStreamingIndicatorInner}>
        <CookingIndicator label={label ?? "Cooking..."} hidden={!label} />
      </div>
    </div>
  );
}
