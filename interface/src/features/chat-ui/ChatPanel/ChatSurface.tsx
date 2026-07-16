import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEventHandler,
  type ForwardRefExoticComponent,
  type ReactNode,
  type RefAttributes,
} from "react";
import { MessageSquare, AlertCircle } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import { ChatMessageList } from "../ChatMessageList";
import {
  DesktopChatInputBar,
  type ChatInputBarHandle,
  type ChatInputBarProps,
  type ContextContentsFetcher,
} from "../ChatInputBar";
import { MessageQueue } from "../MessageQueue";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { ChatStreamingIndicator } from "./ChatStreamingIndicator";
import { DraftedInputBar } from "./DraftedInputBar";
import { useChatPanelState } from "./useChatPanelState";
import { findLatestGeneratedImage } from "./latest-generated-image";
import { useChatUIStore } from "../../../stores/chat-ui-store";
import { useMessageQueueStore } from "../../../stores/message-queue-store";
import {
  useStreamHealth,
  useStuckStreamAutoTimeout,
} from "../../../hooks/stream/use-stream-health";
import { createSetters, ensureEntry } from "../../../hooks/stream/store";
import { getLastSendArgs as getLastAgentChatSendArgs } from "../../../hooks/use-agent-chat-stream";
import { getPartitionSendControl } from "../../../hooks/use-chat-stream/partition-send-control";
import { recordStreamCloseReason } from "../../../shared/observability/stream-breadcrumbs";
import { useErrorReportAgentInfo } from "../../../hooks/use-error-report-agent-info";
import type { AgentMentionTarget, ChatAttachment } from "../../../api/streams";
import type { AgentInstance, Project } from "../../../shared/types";
import type { GenerationMode } from "../../../constants/models";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import type { ContextUsageEntry } from "../../../stores/context-usage-store";
import type { SessionBoundary } from "../../../hooks/use-prior-sessions";
import type { LoadOlderPageFetcher } from "../../../hooks/use-load-older-messages";
import styles from "./ChatPanel.module.css";

const LOADING_OVERLAY_FADE_MS = 120;
// How long after the cold-load reveal we keep image-load pinning active.
// Covers the typical browser image decode tail (a few hundred ms for
// dataURL attachments) so reopening a thread with images doesn't leave
// the viewport drifting above the last bubble.
const IMAGE_PIN_AFTER_REVEAL_MS = 800;
// How long after a stream ends we keep the image-pin window alive.
// Image generation finishes the SSE turn slightly before the browser
// finishes decoding the returned URL, so the bubble's intrinsic
// height grows after `isStreaming` flips back to false. The window
// lets `useImageScrollPin` re-pin on that late layout shift even if
// the user happened to nudge auto-follow off mid-generation.
const IMAGE_PIN_AFTER_STREAM_MS = 6000;

function modelForRetry(
  streamKey: string,
  cachedModel: string | null | undefined,
  generationMode?: GenerationMode,
): string | null {
  if (generationMode) return cachedModel ?? null;
  return (
    useChatUIStore.getState().getSelectedModel(streamKey) ??
    cachedModel ??
    null
  );
}

export interface ChatSurfaceProps {
  streamKey: string;
  transcriptKey?: string;
  onSend: (
    content: string,
    action: string | null,
    selectedModel: string | null,
    attachments?: ChatAttachment[],
    commands?: string[],
    projectId?: string,
    generationMode?: GenerationMode,
    sourceImageUrl?: string,
    agentMentions?: AgentMentionTarget[],
  ) => void;
  onStop: () => void;
  isExternallyBusy?: boolean;
  externalBusyMessage?: string;
  agentName?: string;
  machineType?: "local" | "remote";
  adapterType?: string;
  defaultModel?: string | null;
  templateAgentId?: string;
  agentId?: string;
  isLoading?: boolean;
  historyResolved?: boolean;
  errorMessage?: string | null;
  emptyMessage?: string;
  scrollResetKey?: unknown;
  scrollToBottomOnReset?: boolean;
  focusInputOnThreadReady?: boolean;
  historyMessages?: DisplaySessionEvent[];
  projects?: Project[];
  selectedProjectId?: string;
  llmProjectId?: string;
  onProjectChange?: (projectId: string) => void;
  workspacePath?: string;
  remoteAgentId?: string;
  projectAgents?: AgentInstance[];
  currentAgentInstanceId?: string;
  /** Title bar rendered above the chat area (project/agent bar or subagent header). */
  header?: ReactNode;
  InputBarComponent?: ForwardRefExoticComponent<
    ChatInputBarProps & RefAttributes<ChatInputBarHandle>
  >;
  initialHandoff?: "create-agent";
  onInitialHandoffReady?: () => void;
  contextUsage?: ContextUsageEntry;
  /** Forwarded to the input bar so the Context Composition popover can
   * lazily fetch a bucket's contents when a row is clicked. */
  onFetchContextContents?: ContextContentsFetcher;
  composerTone?: ChatInputBarProps["composerTone"];
  onNewChat?: () => void;
  sendDisabled?: boolean;
  sendDisabledReason?: string;
  /**
   * ChatGPT-style empty-canvas affordance: center the input (and show
   * prompt suggestions) while the thread is empty, docking it to the
   * bottom on the first message. Disabled for the subagent slide-over,
   * whose input must stay docked so it doesn't jump down when the child
   * transcript streams in mid-slide.
   */
  centerInputWhenEmpty?: boolean;
  /**
   * Extra class names applied to the surface root. The layered
   * `ChatPanel` uses this to position the subagent surface as an
   * absolute slide-over and to drive the parent's parallax push.
   */
  className?: string;
  /** Forwarded to the surface root so the coordinator can sequence slide-out unmounts. */
  onAnimationEnd?: AnimationEventHandler<HTMLDivElement>;
  /** Loads the chronologically previous session above the current chat. */
  onLoadPriorSession?: () => void;
  hasPriorSession?: boolean;
  isLoadingPriorSession?: boolean;
  /** Per-session dividers for the prepended prior sessions. */
  sessionBoundaries?: SessionBoundary[];
  /** Fetches one older history page for this thread (cursor-paginated). */
  loadOlderPage?: LoadOlderPageFetcher;
}

/**
 * Renders a single chat thread's full surface: an optional title bar,
 * the scrolling message list with its cold-load reveal / scroll-anchor
 * machinery, the queue, the pinned streaming indicator, and the shared
 * input bar. One instance drives one stream partition; `ChatPanel`
 * stacks two of these (parent thread + subagent slide-over) to play an
 * iOS-style push without remounting or resizing the parent.
 */
export function ChatSurface({
  streamKey,
  transcriptKey,
  onSend,
  onStop,
  isExternallyBusy = false,
  externalBusyMessage,
  agentName,
  machineType,
  adapterType,
  defaultModel,
  templateAgentId,
  agentId,
  isLoading = false,
  historyResolved = true,
  errorMessage,
  emptyMessage,
  scrollResetKey,
  scrollToBottomOnReset,
  focusInputOnThreadReady = true,
  historyMessages,
  projects,
  selectedProjectId,
  llmProjectId,
  onProjectChange,
  workspacePath,
  remoteAgentId,
  projectAgents,
  currentAgentInstanceId,
  header,
  InputBarComponent = DesktopChatInputBar,
  initialHandoff,
  onInitialHandoffReady,
  contextUsage,
  onFetchContextContents,
  composerTone,
  onNewChat,
  sendDisabled = false,
  sendDisabledReason,
  centerInputWhenEmpty = true,
  className,
  onAnimationEnd,
  onLoadPriorSession,
  hasPriorSession,
  isLoadingPriorSession,
  sessionBoundaries,
  loadOlderPage,
}: ChatSurfaceProps) {
  const {
    attachments,
    setAttachments,
    commands,
    setCommands,
    demoRecordOptions,
    setDemoRecordOptions,
    messageAreaRef,
    inputBarRef,
    isMobileLayout,
    handleScroll,
    isAutoFollowing,
    getUserUnpinnedAt,
    isStreaming,
    queue,
    messages,
    bridgeMessages,
    scrollToBottom,
    handleRemoveAttachment,
    handleSend,
    handleQueueEdit,
    handleQueueRemove,
    handleQueueSendNow,
    loadOlder,
    isLoadingOlder,
    hasOlderMessages,
    unreadCount,
  } = useChatPanelState({
    streamKey,
    transcriptKey,
    onSend,
    onStop,
    adapterType,
    defaultModel,
    scrollResetKey,
    scrollToBottomOnReset,
    historyMessages,
    selectedProjectId,
    llmProjectId,
    agentId,
    sendDisabled,
    loadOlderPage,
  });

  // Agent identity + device context attached to every error rendered in
  // this thread, so a user-shared failure always reports which agent
  // (name, local/remote, status) failed and on which device.
  const errorAgentInfo = useErrorReportAgentInfo({
    agentId,
    agentName,
    machineType,
  });

  // Phase 2 stuck-stream actions. The pill in `ChatStreamingIndicator`
  // owns the rendering; this composes the three callbacks against the
  // chat hooks already wired through `onStop` / `onSend`.
  const streamHealth = useStreamHealth(streamKey);

  // Resend the most-recent prompt for this stream. Shared by the
  // stuck-stream pill's Retry action and the per-error-bubble Retry
  // button (`MessageBubble` via `ChatMessageList`).
  const handleRetryLastSend = useCallback(() => {
    if (sendDisabled) return;
    const agentArgs = getLastAgentChatSendArgs(streamKey);
    const partitionArgs = agentArgs
      ? null
      : getPartitionSendControl(streamKey).lastSendArgs;
    onStop();
    if (agentArgs) {
      onSend(
        agentArgs.content,
        agentArgs.action ?? null,
        modelForRetry(
          streamKey,
          agentArgs.selectedModel,
          agentArgs.generationMode,
        ),
        agentArgs.attachments,
        agentArgs.commands,
        agentArgs.projectId,
        agentArgs.generationMode,
        agentArgs.sourceImageUrl,
        undefined,
      );
      return;
    }
    if (partitionArgs) {
      onSend(
        partitionArgs.content,
        partitionArgs.action ?? null,
        modelForRetry(
          streamKey,
          partitionArgs.selectedModel,
          partitionArgs.generationMode,
        ),
        partitionArgs.attachments,
        partitionArgs.commands,
        partitionArgs.projectIdOverride,
        partitionArgs.generationMode,
        partitionArgs.sourceImageUrl,
        partitionArgs.agentMentions,
      );
    }
  }, [onSend, onStop, sendDisabled, streamKey]);

  const handleStuckStreamAutoTimeout = useCallback(() => {
    onStop();
    ensureEntry(streamKey);
    const setters = createSetters(streamKey);
    const id = `assistant-stuck-${Date.now()}`;
    setters.setEvents((prev) => [
      ...prev,
      {
        id,
        clientId: id,
        role: "assistant",
        content:
          "*Agent stopped responding. Local timeout reached — try sending again or press the Report button to send diagnostics.*",
        displayVariant: "streamDropped",
      },
    ]);
    recordStreamCloseReason({
      classified: "disconnected",
      message: "client_auto_timeout",
    });
  }, [onStop, streamKey]);

  useStuckStreamAutoTimeout(streamHealth, handleStuckStreamAutoTimeout);

  const handleNewChat = useCallback(() => {
    if (!onNewChat) return;
    useChatUIStore.getState().setDraft(streamKey, "");
    setAttachments([]);
    setCommands([]);
    useMessageQueueStore.getState().clear(streamKey);
    onNewChat();
    // Place the cursor back in the input on the fresh canvas. The
    // standing focus effect below only re-fires when `inputFocusReadyRef`
    // is `false`, but the new-chat flow doesn't flip `historyResolved`
    // so that ref stays latched from the initial mount. Skip on mobile
    // to avoid popping the on-screen keyboard unprompted.
    if (!isMobileLayout) {
      requestAnimationFrame(() => inputBarRef.current?.focus());
    }
  }, [
    inputBarRef,
    isMobileLayout,
    onNewChat,
    setAttachments,
    setCommands,
    streamKey,
  ]);

  // One-shot pin seeding for chat 3D mode: the moment the user enters
  // 3D mode, if the chat thread already contains a generated image and
  // the per-stream pin slot is empty, auto-pin the most recent one.
  const selectedMode = useChatUIStore((s) => s.streams[streamKey]?.selectedMode);
  const seededFor3DKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedMode !== "3d") {
      seededFor3DKeyRef.current = null;
      return;
    }
    if (seededFor3DKeyRef.current === streamKey) return;
    seededFor3DKeyRef.current = streamKey;
    const existing = useChatUIStore.getState().getPinnedSourceImage(streamKey);
    if (existing) return;
    const latest = findLatestGeneratedImage(messages);
    if (!latest) return;
    useChatUIStore.getState().setPinnedSourceImage(streamKey, {
      imageUrl: latest.imageUrl,
      originalUrl: latest.originalUrl,
      prompt: latest.prompt ?? "",
    });
  }, [streamKey, messages, selectedMode]);

  const hasBridgeFrame = bridgeMessages.length > 0;
  const renderedMessages = messages.length > 0 ? messages : bridgeMessages;

  const isStreamingRef = useRef(isStreaming);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Live mirror of the pin-to-bottom state so the measurement effect
  // below can re-pin without re-subscribing its observers on every
  // follow-state flip.
  const isAutoFollowingRef = useRef(isAutoFollowing);
  useEffect(() => {
    isAutoFollowingRef.current = isAutoFollowing;
  }, [isAutoFollowing]);

  // Keep the pinned cooking indicator (and the chat scroll reserve)
  // anchored to the LIVE input bar height instead of a static ~103px
  // estimate. Without this, activating AURA Council adds the multi-slot
  // footer row to the input bar, but the indicator stays pinned at the
  // 108px default and its opaque backdrop clips the top of the council
  // model pills. Desktop only — the mobile layout pins the indicator
  // off its own keyboard-aware variable.
  const chatAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isMobileLayout || typeof ResizeObserver === "undefined") return;
    const area = chatAreaRef.current;
    if (!area) return;
    const inputBar = area.querySelector<HTMLElement>(
      '[data-agent-surface="chat-input-bar"]',
    );
    if (!inputBar) return;
    // Gap above the input bar (matches the 5px the static 108px tuning
    // exposed) plus the indicator's own ~68px height, so a freshly
    // measured single-row input bar (~103px) reproduces the original
    // 108px / 176px layout exactly.
    const GAP_PX = 5;
    const INDICATOR_PX = 68;
    const pill = inputBar.querySelector<HTMLElement>('[data-input-pill="true"]');
    let frame: number | null = null;
    let lastIndicatorBottom: number | null = null;
    let lastClearance: number | null = null;
    let lastMaskCutoff: number | null = null;
    // If `--chat-input-clearance` changes while the user is pinned to the
    // bottom, the `.messageArea` padding-bottom change would visibly shift
    // the last bubble relative to the input (most noticeably when sending
    // clears a multi-line draft and the bar shrinks). Re-pin in the same
    // frame so the bubble stays anchored.
    const repinIfFollowing = () => {
      const el = messageAreaRef.current;
      if (!el) return;
      if (!isAutoFollowingRef.current) return;
      if (getUserUnpinnedAt() > 0) return;
      el.scrollTop = el.scrollHeight;
    };
    const apply = () => {
      frame = null;
      // Empty-thread centered state: the wrapper includes the hero
      // heading and floats at the lane's vertical center, so both the
      // height and the pill position would produce wildly wrong
      // clearance/mask values. The transcript is empty in this state, so
      // the CSS fallbacks are fine — skip and re-measure once the bar
      // docks (data-centered flips + the dock transition ends; both are
      // observed below).
      if (inputBar.dataset.centered === "true") return;
      const height = inputBar.getBoundingClientRect().height;
      if (height <= 0) return;
      const bottom = Math.round(height + GAP_PX);
      const clearance = bottom + INDICATOR_PX;
      if (lastIndicatorBottom !== bottom) {
        area.style.setProperty("--streaming-indicator-bottom", `${bottom}px`);
        lastIndicatorBottom = bottom;
      }
      if (lastClearance !== clearance) {
        area.style.setProperty("--chat-input-clearance", `${clearance}px`);
        lastClearance = clearance;
        repinIfFollowing();
      }
      // Clip the transcript at the actual input pill's vertical midline
      // (not the whole input section). Measured from the panel bottom so
      // the mask in `.messageArea` cuts content exactly through the middle
      // of the rounded pill, tracking it as it grows. While the bar is
      // mid-flight in the centered→docked transition the pill sits far
      // above its final position, so a cutoff larger than the bar's own
      // clearance is a mid-animation artifact — skip it; the transitionend
      // listener below re-measures once the pill settles.
      if (pill) {
        const areaRect = area.getBoundingClientRect();
        const pillRect = pill.getBoundingClientRect();
        const midFromBottom = Math.round(
          areaRect.bottom - (pillRect.top + pillRect.height / 2),
        );
        if (
          midFromBottom > 0 &&
          midFromBottom <= clearance &&
          lastMaskCutoff !== midFromBottom
        ) {
          area.style.setProperty("--chat-input-mask-cutoff", `${midFromBottom}px`);
          lastMaskCutoff = midFromBottom;
        }
      }
    };
    const scheduleApply = () => {
      if (frame != null) return;
      frame = window.requestAnimationFrame(apply);
    };
    scheduleApply();
    const ro = new ResizeObserver(scheduleApply);
    ro.observe(inputBar);
    // The centered→docked dock animates `bottom`/`transform` (260ms in
    // InputBarShell.module.css) without changing the wrapper's size, so
    // the ResizeObserver alone would leave the pill-midline mask stale at
    // a mid-flight value. Re-measure when the centered flag flips and
    // again when the position transition finishes.
    const mo = new MutationObserver(scheduleApply);
    mo.observe(inputBar, { attributes: true, attributeFilter: ["data-centered"] });
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== inputBar) return;
      if (event.propertyName === "bottom" || event.propertyName === "transform") {
        scheduleApply();
      }
    };
    inputBar.addEventListener("transitionend", onTransitionEnd);
    return () => {
      if (frame != null) {
        window.cancelAnimationFrame(frame);
      }
      ro.disconnect();
      mo.disconnect();
      inputBar.removeEventListener("transitionend", onTransitionEnd);
      area.style.removeProperty("--streaming-indicator-bottom");
      area.style.removeProperty("--chat-input-clearance");
      area.style.removeProperty("--chat-input-mask-cutoff");
    };
  }, [isMobileLayout, streamKey, messageAreaRef, getUserUnpinnedAt]);

  // Cache-first session switching: when the chat-history store already
  // holds a (possibly stale) transcript for this thread — LRU hit,
  // IndexedDB hydrate, or a stale entry pending revalidation — paint it
  // immediately instead of arming the cold-load overlay. The background
  // refetch reconciles content in place; the overlay is reserved for
  // true cold misses where there is nothing to show.
  const hasPaintableTranscript = renderedMessages.length > 0;
  const initialHandoffReadyRef = useRef(false);
  const inputFocusReadyRef = useRef(false);
  const hasHandledThreadResetRef = useRef(false);
  const initialColdLoadRef = useRef(
    !historyResolved && !hasBridgeFrame && !hasPaintableTranscript,
  );
  const hasInitiallyRevealedRef = useRef(
    historyResolved || hasBridgeFrame || hasPaintableTranscript,
  );
  const revealAnimationFrameRef = useRef<number | null>(null);
  const loadingOverlayTimeoutRef = useRef<number | null>(null);
  const [isInitialThreadRevealReady, setIsInitialThreadRevealReady] = useState(
    () => historyResolved || hasBridgeFrame || hasPaintableTranscript,
  );
  const [isLoadingOverlayVisible, setIsLoadingOverlayVisible] = useState(
    () => !historyResolved && !hasBridgeFrame && !hasPaintableTranscript,
  );
  const [isLoadingOverlayFadingOut, setIsLoadingOverlayFadingOut] = useState(false);
  const [imagePinUntil, setImagePinUntil] = useState<number>(
    () => Date.now() + IMAGE_PIN_AFTER_REVEAL_MS,
  );

  const contentReady = (historyResolved && !isLoading) || hasBridgeFrame;
  const shouldArmColdLoad =
    !historyResolved && !hasBridgeFrame && !hasPaintableTranscript;
  const shouldHideThreadForInitialReveal =
    initialColdLoadRef.current &&
    historyResolved &&
    messages.length > 0 &&
    !isInitialThreadRevealReady;
  const shouldShowColdLoadOverlay =
    !errorMessage &&
    initialColdLoadRef.current &&
    (!historyResolved || shouldHideThreadForInitialReveal);
  const threadReady = contentReady && !shouldHideThreadForInitialReveal;

  useEffect(() => {
    hasHandledThreadResetRef.current = true;
    initialHandoffReadyRef.current = false;
    inputFocusReadyRef.current = false;
    if (revealAnimationFrameRef.current != null) {
      cancelAnimationFrame(revealAnimationFrameRef.current);
      revealAnimationFrameRef.current = null;
    }

    if (!shouldArmColdLoad || isStreamingRef.current) {
      initialColdLoadRef.current = false;
      hasInitiallyRevealedRef.current = true;
      setIsInitialThreadRevealReady(true);
      setImagePinUntil(Date.now() + IMAGE_PIN_AFTER_REVEAL_MS);
      return;
    }

    initialColdLoadRef.current = true;
    hasInitiallyRevealedRef.current = false;
    setIsInitialThreadRevealReady(false);
    if (loadingOverlayTimeoutRef.current != null) {
      clearTimeout(loadingOverlayTimeoutRef.current);
      loadingOverlayTimeoutRef.current = null;
    }
    setIsLoadingOverlayVisible(true);
    setIsLoadingOverlayFadingOut(false);
    setImagePinUntil(Date.now() + IMAGE_PIN_AFTER_REVEAL_MS);
  }, [initialHandoff, scrollResetKey]);

  useEffect(() => {
    if (hasInitiallyRevealedRef.current) {
      return;
    }

    if (!historyResolved) {
      initialColdLoadRef.current = true;
      setIsInitialThreadRevealReady(false);
      return;
    }

    if (messages.length === 0) {
      initialColdLoadRef.current = false;
      hasInitiallyRevealedRef.current = true;
      setIsInitialThreadRevealReady(true);
      return;
    }

    if (!initialColdLoadRef.current) return;
    if (revealAnimationFrameRef.current != null) {
      cancelAnimationFrame(revealAnimationFrameRef.current);
    }
    revealAnimationFrameRef.current = requestAnimationFrame(() => {
      revealAnimationFrameRef.current = requestAnimationFrame(() => {
        revealAnimationFrameRef.current = null;
        initialColdLoadRef.current = false;
        hasInitiallyRevealedRef.current = true;
        setIsInitialThreadRevealReady(true);
        setImagePinUntil(Date.now() + IMAGE_PIN_AFTER_REVEAL_MS);
      });
    });
  }, [historyResolved, messages.length]);

  useEffect(
    () => () => {
      if (revealAnimationFrameRef.current != null) {
        cancelAnimationFrame(revealAnimationFrameRef.current);
      }
      if (loadingOverlayTimeoutRef.current != null) {
        clearTimeout(loadingOverlayTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (errorMessage) {
      if (loadingOverlayTimeoutRef.current != null) {
        clearTimeout(loadingOverlayTimeoutRef.current);
        loadingOverlayTimeoutRef.current = null;
      }
      setIsLoadingOverlayVisible(false);
      setIsLoadingOverlayFadingOut(false);
      return;
    }

    if (shouldShowColdLoadOverlay) {
      if (loadingOverlayTimeoutRef.current != null) {
        clearTimeout(loadingOverlayTimeoutRef.current);
        loadingOverlayTimeoutRef.current = null;
      }
      setIsLoadingOverlayVisible(true);
      setIsLoadingOverlayFadingOut(false);
      return;
    }

    if (!isLoadingOverlayVisible || isLoadingOverlayFadingOut) {
      return;
    }

    setIsLoadingOverlayFadingOut(true);
    loadingOverlayTimeoutRef.current = window.setTimeout(() => {
      loadingOverlayTimeoutRef.current = null;
      setIsLoadingOverlayVisible(false);
      setIsLoadingOverlayFadingOut(false);
    }, LOADING_OVERLAY_FADE_MS);
  }, [
    errorMessage,
    isLoadingOverlayFadingOut,
    isLoadingOverlayVisible,
    shouldShowColdLoadOverlay,
  ]);

  const handleInitialAnchorReady = useCallback(() => {
    if (!initialColdLoadRef.current || !historyResolved || messages.length === 0) {
      return;
    }
    if (revealAnimationFrameRef.current != null) {
      cancelAnimationFrame(revealAnimationFrameRef.current);
    }
    revealAnimationFrameRef.current = requestAnimationFrame(() => {
      revealAnimationFrameRef.current = requestAnimationFrame(() => {
        revealAnimationFrameRef.current = null;
        initialColdLoadRef.current = false;
        hasInitiallyRevealedRef.current = true;
        setIsInitialThreadRevealReady(true);
        setImagePinUntil(Date.now() + IMAGE_PIN_AFTER_REVEAL_MS);
      });
    });
  }, [historyResolved, messages.length]);

  useEffect(() => {
    setImagePinUntil(Date.now() + IMAGE_PIN_AFTER_STREAM_MS);
  }, [isStreaming]);

  useEffect(() => {
    if (
      !focusInputOnThreadReady ||
      isMobileLayout ||
      !threadReady ||
      inputFocusReadyRef.current
    ) {
      return;
    }
    inputFocusReadyRef.current = true;
    requestAnimationFrame(() => inputBarRef.current?.focus());
  }, [
    focusInputOnThreadReady,
    inputBarRef,
    initialHandoff,
    isMobileLayout,
    scrollResetKey,
    threadReady,
  ]);

  useEffect(() => {
    if (!initialHandoff || !threadReady || initialHandoffReadyRef.current) {
      return;
    }
    initialHandoffReadyRef.current = true;
    onInitialHandoffReady?.();
  }, [initialHandoff, onInitialHandoffReady, threadReady]);

  const isThreadEmpty =
    historyResolved &&
    !errorMessage &&
    messages.length === 0 &&
    !isStreaming &&
    queue.length === 0 &&
    !shouldHideThreadForInitialReveal;

  // Memoized so a stable reference is handed to the memoized
  // `ChatMessageList`; otherwise a fresh element each render (e.g. on
  // every draft keystroke) would defeat the list's `React.memo`.
  const emptyState = useMemo(
    () =>
      errorMessage ? (
        <div className={styles.emptyState}>
          <AlertCircle size={40} />
          <Text variant="muted" size="sm">
            {errorMessage}
          </Text>
        </div>
      ) : historyResolved && emptyMessage ? (
        <div className={styles.emptyState}>
          <MessageSquare size={40} />
          <Text variant="muted" size="sm">
            {emptyMessage}
          </Text>
        </div>
      ) : null,
    [errorMessage, historyResolved, emptyMessage],
  );

  return (
    <div
      className={`${styles.surface}${className ? ` ${className}` : ""}`}
      onAnimationEnd={onAnimationEnd}
    >
      {header}
      <div className={styles.chatArea} ref={chatAreaRef}>
        <div className={styles.messageAreaShell}>
          <div
            className={`${styles.messageArea}${isAutoFollowing ? ` ${styles.messageAreaFollowing}` : ` ${styles.messageAreaReading}`}`}
            ref={messageAreaRef}
            onScroll={handleScroll}
          >
            <div
              className={`${styles.messageContent}${shouldHideThreadForInitialReveal ? ` ${styles.messageContentHidden}` : ""}`}
            >
              <ChatMessageList
                messages={renderedMessages}
                streamKey={streamKey}
                scrollRef={messageAreaRef}
                emptyState={emptyState}
                onLoadOlder={loadOlder}
                isLoadingOlder={isLoadingOlder}
                hasOlderMessages={hasOlderMessages}
                onLoadPriorSession={onLoadPriorSession}
                hasPriorSession={hasPriorSession}
                isLoadingPriorSession={isLoadingPriorSession}
                sessionBoundaries={sessionBoundaries}
                onInitialAnchorReady={handleInitialAnchorReady}
                onRetry={handleRetryLastSend}
                errorAgentInfo={errorAgentInfo}
                agentId={agentId}
                isAutoFollowing={isAutoFollowing}
                getUserUnpinnedAt={getUserUnpinnedAt}
                density={isMobileLayout ? "mobile" : "desktop"}
                imagePinUntil={imagePinUntil}
              />
            </div>
          </div>
          {isLoadingOverlayVisible && (
            <div
              className={`${styles.initialRevealOverlay}${isLoadingOverlayFadingOut ? ` ${styles.initialRevealOverlayFading}` : ""}`}
            />
          )}
          <OverlayScrollbar scrollRef={messageAreaRef} />
          {!isAutoFollowing && unreadCount > 0 && (
            <button
              type="button"
              className={styles.newMessagesPill}
              onClick={scrollToBottom}
            >
              {unreadCount} new message{unreadCount !== 1 ? "s" : ""} ↓
            </button>
          )}
        </div>

        {queue.length > 0 && (
          <div className={styles.queueSection}>
            <MessageQueue
              streamKey={streamKey}
              onEdit={handleQueueEdit}
              onRemove={handleQueueRemove}
              onSendNow={handleQueueSendNow}
            />
          </div>
        )}

        <ChatStreamingIndicator
          streamKey={streamKey}
          onStop={onStop}
          onRetry={handleRetryLastSend}
        />

        <DraftedInputBar
          InputBarComponent={InputBarComponent}
          ref={inputBarRef}
          onSend={handleSend}
          onStop={onStop}
          streamKey={streamKey}
          isExternallyBusy={isExternallyBusy}
          externalBusyMessage={externalBusyMessage}
          adapterType={adapterType}
          defaultModel={defaultModel}
          machineType={machineType}
          templateAgentId={templateAgentId}
          agentId={agentId}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onRemoveAttachment={handleRemoveAttachment}
          selectedCommands={commands}
          onCommandsChange={setCommands}
          demoRecordOptions={demoRecordOptions}
          onDemoRecordOptionsChange={setDemoRecordOptions}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onProjectChange={onProjectChange}
          workspacePath={workspacePath}
          remoteAgentId={remoteAgentId}
          projectAgents={projectAgents}
          currentAgentInstanceId={currentAgentInstanceId}
          isVisible
          isCentered={centerInputWhenEmpty && isThreadEmpty}
          contextUsage={contextUsage}
          onFetchContextContents={onFetchContextContents}
          composerTone={composerTone}
          onNewChat={onNewChat ? handleNewChat : undefined}
          sendDisabled={sendDisabled}
          sendDisabledReason={sendDisabledReason}
        />
      </div>
    </div>
  );
}
