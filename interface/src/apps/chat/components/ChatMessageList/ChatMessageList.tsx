import {
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { MessageBubble } from "../MessageBubble";
import { StreamingBubble } from "../StreamingBubble";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";

import { useStreamStore } from "../../../../hooks/stream/store";
import { useImageScrollPin } from "../../../../shared/hooks/use-image-scroll-pin";

interface ChatMessageListProps {
  messages: DisplaySessionEvent[];
  streamKey: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  emptyState?: ReactNode;
  onLoadOlder?: () => void;
  isLoadingOlder?: boolean;
  hasOlderMessages?: boolean;
  onInitialAnchorReady?: () => void;
  isAutoFollowing?: boolean;
  density?: "desktop" | "mobile";
  /** Optional UNIX-ms deadline; while now < deadline, image-load
   * events re-pin the scroll container even if the user isn't strictly
   * auto-following yet. Used by `ChatPanel` to keep the cold-load
   * reveal anchored while attachments decode. */
  imagePinUntil?: number;
}

const EMPTY_TOOL_CALLS: NonNullable<
  ReturnType<typeof useStreamStore.getState>["entries"][string]
>["activeToolCalls"] = [];
const EMPTY_TIMELINE: NonNullable<
  ReturnType<typeof useStreamStore.getState>["entries"][string]
>["timeline"] = [];

function messageRenderKey(
  msg: DisplaySessionEvent,
  index: number,
  visibleCount: number,
): string {
  if (msg.role === "assistant" && index === visibleCount - 1) {
    return "assistant-tail";
  }
  return msg.id;
}

/**
 * Renders the full chat transcript in natural flex flow. Pin-to-bottom and
 * reading-position preservation when content above the viewport changes
 * size are handled by the browser via CSS `overflow-anchor: auto` on the
 * parent scroll container (see `ChatPanel.module.css`). This component only
 * needs to push scrollTop to the fresh bottom when the last item itself
 * grows (streaming tokens, a new message arriving while pinned) — a case
 * the native scroll-anchoring algorithm doesn't cover, since it only
 * compensates for size changes above the anchor.
 */
export function ChatMessageList({
  messages,
  streamKey,
  scrollRef,
  emptyState,
  onLoadOlder,
  isLoadingOlder,
  hasOlderMessages,
  onInitialAnchorReady,
  isAutoFollowing = true,
  density = "desktop",
  imagePinUntil,
}: ChatMessageListProps) {
  useImageScrollPin(scrollRef, {
    isAutoFollowing,
    initialRevealUntil: imagePinUntil,
  });
  const {
    isStreaming,
    isWriting,
    streamingText,
    thinkingText,
    thinkingDurationMs,
    activeToolCalls,
    timeline,
    progressText,
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
    })),
  );

  const nowStreaming =
    isStreaming || !!streamingText || !!thinkingText || activeToolCalls.length > 0;
  const liveAssistantBubbleHasText = !!streamingText || !!thinkingText;
  const visibleMessages =
    liveAssistantBubbleHasText &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "assistant"
      ? messages.slice(0, -1)
      : messages;
  const prevStreamingRef = useRef(nowStreaming);
  const justFinalizedIdRef = useRef<string | null>(null);

  // Detect streaming -> not-streaming transition during render so the
  // MessageBubble for the just-finalized message mounts with its thinking /
  // activity rows expanded, matching the live assistant row it replaces. This
  // has to happen during render (not useEffect) because `initialThinkingExpanded`
  // is read once at MessageBubble mount — deferring to useEffect means the
  // bubble mounts collapsed for one frame and then can't be re-expanded.
  // React Compiler's "no refs during render" rule doesn't distinguish this
  // legitimate render-phase derivation from genuine misuse, so we disable it
  // narrowly for this block.
  /* eslint-disable react-hooks/refs */
  {
    const wasStreaming = prevStreamingRef.current;
    if (wasStreaming && !nowStreaming) {
      const lastMsg = messages[messages.length - 1];
      justFinalizedIdRef.current = lastMsg ? lastMsg.id : null;
    }
    prevStreamingRef.current = nowStreaming;
  }
  /* eslint-enable react-hooks/refs */

  const hasMessages =
    messages.length > 0 ||
    isStreaming ||
    streamingText ||
    thinkingText ||
    activeToolCalls.length > 0 ||
    timeline.length > 0;

  const initialLayoutReadyKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!hasMessages) {
      initialLayoutReadyKeyRef.current = null;
      return;
    }
    const initialLayoutReadyKey = `${streamKey}:ready`;
    if (initialLayoutReadyKeyRef.current === initialLayoutReadyKey) {
      return;
    }
    initialLayoutReadyKeyRef.current = initialLayoutReadyKey;
    onInitialAnchorReady?.();
  }, [hasMessages, onInitialAnchorReady, streamKey]);

  // Pin to bottom when the tail grows. CSS scroll anchoring handles content
  // growth *above* the in-view anchor; it does not compensate for growth
  // *at* the anchor itself, so we explicitly push scrollTop to scrollHeight
  // whenever the streaming bubble gains tokens, a new message arrives, or
  // a tool-row reveals content — but only while the user is actually pinned.
  useLayoutEffect(() => {
    if (!hasMessages || !isAutoFollowing) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    hasMessages,
    isAutoFollowing,
    scrollRef,
    messages.length,
    streamingText,
    thinkingText,
    activeToolCalls.length,
    progressText,
  ]);

  if (!hasMessages) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {hasOlderMessages && (
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
          {isLoadingOlder ? (
            <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Loading...</span>
          ) : (
            <button
              type="button"
              onClick={onLoadOlder}
              style={{
                background: "none",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                padding: "6px 16px",
                color: "var(--color-text-secondary)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Load older messages
            </button>
          )}
        </div>
      )}
      {visibleMessages.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: density === "mobile" ? 6 : 2,
            flexShrink: 0,
          }}
        >
          {/* eslint-disable-next-line react-hooks/refs -- reading justFinalizedIdRef.current here is part of the intentional render-phase pattern documented above the transition detection */}
          {visibleMessages.map((msg, index) => (
            <div
              key={messageRenderKey(msg, index, visibleMessages.length)}
              data-message-id={msg.id}
              style={{ display: "flex", width: "100%" }}
            >
              <MessageBubble
                message={msg}
                isStreaming={isStreaming && msg.id.startsWith("stream-")}
                initialThinkingExpanded={msg.id === justFinalizedIdRef.current}
                initialActivitiesExpanded={msg.id === justFinalizedIdRef.current}
              />
            </div>
          ))}
        </div>
      )}
      {nowStreaming && (
        <div>
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
          />
        </div>
      )}
    </>
  );
}
