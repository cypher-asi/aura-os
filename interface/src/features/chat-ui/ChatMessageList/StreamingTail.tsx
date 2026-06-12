import { useShallow } from "zustand/react/shallow";
import { StreamingBubble } from "../../../apps/chat/components/StreamingBubble";
import { useStreamStore } from "../../../hooks/stream/store";

type StreamEntry = NonNullable<
  ReturnType<typeof useStreamStore.getState>["entries"][string]
>;

const EMPTY_TOOL_CALLS: StreamEntry["activeToolCalls"] = [];
const EMPTY_TIMELINE: StreamEntry["timeline"] = [];

/**
 * The live in-flight turn at the bottom of the transcript. This is the
 * only component that subscribes to the per-token streaming fields
 * (`streamingText`, `timeline`, ...), so word-reveal ticks re-render
 * just this tail instead of the whole `ChatMessageList` map.
 */
export function StreamingTail({ streamKey }: { streamKey: string }) {
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
