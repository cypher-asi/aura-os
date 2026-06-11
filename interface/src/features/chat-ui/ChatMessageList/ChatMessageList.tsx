import {
  memo,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { MessageBubble } from "../../../apps/chat/components/MessageBubble";
import { StreamingBubble } from "../../../apps/chat/components/StreamingBubble";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import type { ErrorReportAgentInfo } from "../../../hooks/use-error-report-agent-info";

import { useStreamStore } from "../../../hooks/stream/store";
import { useImageScrollPin } from "../../../shared/hooks/use-image-scroll-pin";
import { SessionGalleryContext } from "../../../components/Gallery";
import { collectSessionImages } from "./collect-session-images";
import { PriorSessionDivider } from "./PriorSessionDivider";
import type { SessionBoundary } from "../../../hooks/use-prior-sessions";

interface ChatMessageListProps {
  messages: DisplaySessionEvent[];
  streamKey: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  emptyState?: ReactNode;
  onLoadOlder?: () => void;
  isLoadingOlder?: boolean;
  hasOlderMessages?: boolean;
  /** Loads the chronologically previous session above the current chat. */
  onLoadPriorSession?: () => void;
  hasPriorSession?: boolean;
  isLoadingPriorSession?: boolean;
  /** Labeled dividers inserted before the first message of each session block. */
  sessionBoundaries?: SessionBoundary[];
  onInitialAnchorReady?: () => void;
  /**
   * Resend the most-recent prompt for this stream. Forwarded to each
   * `MessageBubble` so error bubbles can render a manual Retry button.
   * Optional because read-only/historical surfaces don't supply it.
   */
  onRetry?: () => void;
  /**
   * Agent + device context forwarded to each error bubble so a
   * user-shared failure carries the agent name, local/remote type,
   * status, and device. Optional on read-only/historical surfaces.
   */
  errorAgentInfo?: ErrorReportAgentInfo;
  /** Agent id forwarded to error bubbles' `ReportBugButton`. */
  agentId?: string;
  isAutoFollowing?: boolean;
  /** Returns a non-zero `performance.now()` timestamp once the user has
   * shown explicit upward scroll intent (wheel/touch/keyboard). When
   * non-zero, the tail-pin layout effect and `useImageScrollPin` both
   * suppress writes to `scrollTop` so the user's reading position is
   * preserved during streams and the post-stream image-pin window. */
  getUserUnpinnedAt?: () => number;
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

/**
 * Renders the full chat transcript in natural flex flow. Pin-to-bottom and
 * reading-position preservation when content above the viewport changes
 * size are handled by the browser via CSS `overflow-anchor: auto` on the
 * parent scroll container (see `ChatPanel.module.css`). This component only
 * needs to push scrollTop to the fresh bottom when the last item itself
 * grows (streaming tokens, a new message arriving while pinned) — a case
 * the native scroll-anchoring algorithm doesn't cover, since it only
 * compensates for size changes above the anchor.
 *
 * Wrapped in `React.memo` (see export below) so draft-input keystrokes in
 * the parent `ChatSurface` don't re-run the whole transcript map; the
 * component still re-renders on its own stream-store subscription during
 * live streaming.
 */
function ChatMessageListImpl({
  messages,
  streamKey,
  scrollRef,
  emptyState,
  onLoadOlder,
  isLoadingOlder,
  hasOlderMessages,
  onLoadPriorSession,
  hasPriorSession,
  isLoadingPriorSession,
  sessionBoundaries,
  onInitialAnchorReady,
  onRetry,
  errorAgentInfo,
  agentId,
  isAutoFollowing = true,
  getUserUnpinnedAt,
  density = "desktop",
  imagePinUntil,
}: ChatMessageListProps) {
  useImageScrollPin(scrollRef, {
    isAutoFollowing,
    initialRevealUntil: imagePinUntil,
    getUserUnpinnedAt,
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

  const nowStreaming =
    isStreaming || !!streamingText || !!thinkingText || activeToolCalls.length > 0;
  const liveAssistantBubbleHasText = !!streamingText || !!thinkingText;
  const visibleMessages =
    liveAssistantBubbleHasText &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "assistant"
      ? messages.slice(0, -1)
      : messages;
  // Session-wide gallery list. Recomputed only when the visible
  // message slice changes (not on every streaming token), then
  // published via context so any image click inside a bubble can open
  // the shared overlay with the full set + forward/back navigation.
  const sessionGalleryImages = useMemo(
    () => collectSessionImages(visibleMessages),
    [visibleMessages],
  );
  const boundaryByEventId = useMemo(() => {
    const map = new Map<string, SessionBoundary>();
    for (const boundary of sessionBoundaries ?? []) {
      map.set(boundary.firstEventId, boundary);
    }
    return map;
  }, [sessionBoundaries]);
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

  // Scroll-preservation bookkeeping for prepends (see the effect below).
  const prevScrollMetricsRef = useRef({ scrollHeight: 0, distanceFromBottom: 0 });
  const prevTopMessageIdRef = useRef<string | undefined>(undefined);

  // Pin to bottom when the tail grows. CSS scroll anchoring handles content
  // growth *above* the in-view anchor; it does not compensate for growth
  // *at* the anchor itself, so we explicitly push scrollTop to scrollHeight
  // whenever the streaming bubble gains tokens, a new message arrives, or
  // a tool-row reveals content — but only while the user is actually pinned.
  // The `getUserUnpinnedAt` check is defense in depth against same-tick
  // races where the user's wheel/touch event fires after this layout effect
  // has already been scheduled but before `isAutoFollowing` re-renders.
  useLayoutEffect(() => {
    if (!hasMessages || !isAutoFollowing) return;
    if (getUserUnpinnedAt && getUserUnpinnedAt() > 0) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    hasMessages,
    isAutoFollowing,
    getUserUnpinnedAt,
    scrollRef,
    messages.length,
    streamingText,
    thinkingText,
    activeToolCalls.length,
    progressText,
  ]);

  // Keep the viewport stable when older content is prepended (e.g.
  // "Load prior session"). Prepending above the viewport leaves the
  // distance from the bottom unchanged, so we hold that distance
  // constant. Setting `scrollTop` to an absolute computed value (rather
  // than nudging by a delta) is idempotent: even if the browser's native
  // scroll anchoring already shifted the position this frame, the final
  // value lands exactly where the previously-visible messages were, so
  // nothing jumps. Detected via the top message id changing to an older
  // message that is still present further down the list.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const topId = messages[0]?.id;
    const prevTopId = prevTopMessageIdRef.current;
    if (
      prevTopId !== undefined &&
      topId !== prevTopId &&
      messages.some((m) => m.id === prevTopId)
    ) {
      el.scrollTop = el.scrollHeight - prevScrollMetricsRef.current.distanceFromBottom;
    }
    prevScrollMetricsRef.current = {
      scrollHeight: el.scrollHeight,
      distanceFromBottom: el.scrollHeight - el.scrollTop,
    };
    prevTopMessageIdRef.current = topId;
  }, [messages, scrollRef]);

  if (!hasMessages) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {hasPriorSession && (
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
          {isLoadingPriorSession ? (
            <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Loading...</span>
          ) : (
            <button
              type="button"
              onClick={onLoadPriorSession}
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
              Load prior session
            </button>
          )}
        </div>
      )}
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
        <SessionGalleryContext.Provider value={sessionGalleryImages}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: density === "mobile" ? 6 : 8,
              flexShrink: 0,
            }}
          >
            {/* eslint-disable-next-line react-hooks/refs -- reading justFinalizedIdRef.current here is part of the intentional render-phase pattern documented above the transition detection */}
            {visibleMessages.map((msg) => {
              const boundary = boundaryByEventId.get(msg.id);
              return (
                <div key={msg.clientId ?? msg.id} style={{ display: "contents" }}>
                  {boundary && (
                    <PriorSessionDivider
                      label={boundary.label}
                      startedAt={boundary.startedAt}
                    />
                  )}
                  <div
                    data-message-id={msg.id}
                    style={{ display: "flex", width: "100%" }}
                  >
                    <MessageBubble
                      message={msg}
                      isStreaming={isStreaming && msg.id.startsWith("stream-")}
                      initialThinkingExpanded={msg.id === justFinalizedIdRef.current}
                      initialActivitiesExpanded={msg.id === justFinalizedIdRef.current}
                      streamKey={streamKey}
                      agentId={agentId}
                      errorAgentInfo={errorAgentInfo}
                      onRetry={onRetry}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </SessionGalleryContext.Provider>
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
            generationKind={generationKind}
            generationPercent={generationPercent}
          />
        </div>
      )}
    </>
  );
}

export const ChatMessageList = memo(ChatMessageListImpl);
ChatMessageList.displayName = "ChatMessageList";
