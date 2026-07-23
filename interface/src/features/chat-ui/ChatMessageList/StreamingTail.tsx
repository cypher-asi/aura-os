import { type RefObject, useLayoutEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { StreamingBubble } from "../../../apps/chat/components/StreamingBubble";
import { useStreamStore } from "../../../hooks/stream/store";

type StreamEntry = NonNullable<
  ReturnType<typeof useStreamStore.getState>["entries"][string]
>;

const EMPTY_TOOL_CALLS: StreamEntry["activeToolCalls"] = [];
const EMPTY_TIMELINE: StreamEntry["timeline"] = [];

interface StreamingTailProps {
  streamKey: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  isAutoFollowing: boolean;
  getUserUnpinnedAt?: () => number;
}

/**
 * The live in-flight turn at the bottom of the transcript. This is the
 * only component that subscribes to the per-token streaming fields
 * (`streamingText`, `timeline`, ...), so word-reveal ticks re-render
 * just this tail instead of the whole `ChatMessageList` map.
 */
export function StreamingTail({
  streamKey,
  scrollRef,
  isAutoFollowing,
  getUserUnpinnedAt,
}: StreamingTailProps) {
  const {
    isStreaming,
    isWriting,
    streamingText,
    thinkingText,
    thinkingDurationMs,
    activeToolCalls,
    timeline,
    progressText,
    generationKind,
    generationPercent,
  } = useStreamStore(
    useShallow((state) => ({
      isStreaming: state.entries[streamKey]?.isStreaming ?? false,
      isWriting: state.entries[streamKey]?.isWriting ?? false,
      streamingText: state.entries[streamKey]?.streamingText ?? "",
      thinkingText: state.entries[streamKey]?.thinkingText ?? "",
      thinkingDurationMs: state.entries[streamKey]?.thinkingDurationMs ?? null,
      activeToolCalls: state.entries[streamKey]?.activeToolCalls ?? EMPTY_TOOL_CALLS,
      timeline: state.entries[streamKey]?.timeline ?? EMPTY_TIMELINE,
      progressText: state.entries[streamKey]?.progressText ?? "",
      generationKind: state.entries[streamKey]?.generationKind ?? null,
      generationPercent: state.entries[streamKey]?.generationPercent ?? null,
    })),
  );

  // The transcript parent intentionally does not re-render on token ticks.
  // Re-pin here after each live-tail commit so growing thinking/text remains
  // visible instead of slipping behind the pinned phase indicator. The
  // explicit-intent check protects the same-tick window before the parent's
  // `isAutoFollowing` state update lands.
  useLayoutEffect(() => {
    if (!isAutoFollowing) return;
    if (getUserUnpinnedAt && getUserUnpinnedAt() > 0) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  });

  return (
    <StreamingBubble
      isStreaming={isStreaming}
      text={streamingText}
      toolCalls={activeToolCalls}
      thinkingText={thinkingText}
      thinkingDurationMs={thinkingDurationMs}
      timeline={timeline}
      progressText={progressText}
      isWriting={isWriting}
      showPhaseIndicator={false}
      generationKind={generationKind}
      generationPercent={generationPercent}
    />
  );
}
