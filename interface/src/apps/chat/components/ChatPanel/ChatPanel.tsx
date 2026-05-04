import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ForwardRefExoticComponent,
  type ReactNode,
  type RefAttributes,
} from "react";
import { MessageSquare, AlertCircle } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import { ChatMessageList } from "../ChatMessageList";
import { DesktopChatInputBar, type ChatInputBarHandle, type ChatInputBarProps } from "../ChatInputBar";
import { MessageQueue } from "../MessageQueue";
import { OverlayScrollbar } from "../../../../components/OverlayScrollbar";
import { PromptSuggestions } from "../PromptSuggestions/PromptSuggestions";
import { ChatStreamingIndicator } from "./ChatStreamingIndicator";
import { useChatPanelState } from "./useChatPanelState";
import { useProgressText } from "../../../../hooks/stream/hooks";
import type { ChatAttachment } from "../../../../api/streams";
import type { Project } from "../../../../shared/types";
import type { GenerationMode } from "../../../../constants/models";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";
import type { ContextUsageEntry } from "../../../../stores/context-usage-store";
import styles from "./ChatPanel.module.css";

type ChatPanelHandoffMode = "create-agent";
const LOADING_OVERLAY_FADE_MS = 120;

export interface ChatPanelProps {
  streamKey: string;
  onSend: (
    content: string,
    action: string | null,
    selectedModel: string | null,
    attachments?: ChatAttachment[],
    commands?: string[],
    projectId?: string,
    generationMode?: GenerationMode,
  ) => void;
  onStop: () => void;
  /**
   * Treat the chat as streaming even when our own SSE is idle. Used
   * when another subsystem (e.g. the automation loop) is holding a
   * turn on the same upstream agent. ChatPanel then renders the stop
   * icon so the caller's `onStop` can cancel that external work.
   */
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
  onProjectChange?: (projectId: string) => void;
  header?: ReactNode;
  InputBarComponent?: ForwardRefExoticComponent<ChatInputBarProps & RefAttributes<ChatInputBarHandle>>;
  initialHandoff?: ChatPanelHandoffMode;
  onInitialHandoffReady?: () => void;
  contextUsage?: ContextUsageEntry;
  onNewSession?: () => void;
  /**
   * Render the input bar in compact mode (e.g. inside floating desktop
   * agent windows). Suppresses the "/ for commands" hint to save room.
   */
  compact?: boolean;
}

export function ChatPanel({
  streamKey,
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
  onProjectChange,
  header,
  InputBarComponent = DesktopChatInputBar,
  initialHandoff,
  onInitialHandoffReady,
  contextUsage,
  onNewSession,
  compact = false,
}: ChatPanelProps) {
  const {
    input,
    setInput,
    attachments,
    setAttachments,
    commands,
    setCommands,
    messageAreaRef,
    inputBarRef,
    isMobileLayout,
    handleScroll,
    isAutoFollowing,
    isStreaming,
    queue,
    messages,
    scrollToBottom,
    handleRemoveAttachment,
    handleSend,
    handleQueueEdit,
    handleQueueMoveUp,
    handleQueueRemove,
    loadOlder,
    isLoadingOlder,
    hasOlderMessages,
    unreadCount,
  } = useChatPanelState({
    streamKey,
    onSend,
    adapterType,
    defaultModel,
    scrollResetKey,
    scrollToBottomOnReset,
    historyMessages,
    selectedProjectId,
    agentId,
  });

  // Phase 3 server emits `progress { stage: "queued" }` as the first
  // SSE event when our turn is waiting behind another on the same
  // upstream agent partition. The chat-stream handler stamps that
  // stage into the stream store's `progressText`; downstream text /
  // tool / thinking deltas wipe it (handlers/text.ts, thinking.ts,
  // shared.ts). So a derived `isQueued` from this slot is exactly
  // "queued and the actual turn hasn't started yet".
  const progressText = useProgressText(streamKey);
  const isQueued = progressText === "queued";

  const initialHandoffReadyRef = useRef(false);
  const inputFocusReadyRef = useRef(false);
  const initialColdLoadRef = useRef(!historyResolved);
  // Latches `true` once we've completed the initial reveal for the current
  // chat (warm mount, cold-load anchor-ready, or empty-thread short circuit).
  // Subsequent transient `historyResolved=false` flips MUST NOT re-arm the
  // cold-load machinery, otherwise the next flip back to `true` re-applies
  // `.messageContentHidden` and the entire transcript flashes
  // `visibility: hidden` for ~2 frames mid-turn. `historyResolved` flaps
  // during normal chat whenever the chat-history-store evicts our entry
  // (`MAX_HISTORY_ENTRIES = 8`) and a follow-up WS event re-creates it via
  // `fetchHistory`, which transitions status `"loading"` → `"ready"`.
  // Reset only on real chat switches via the `[initialHandoff, scrollResetKey]`
  // effect below.
  const hasInitiallyRevealedRef = useRef(historyResolved);
  const revealAnimationFrameRef = useRef<number | null>(null);
  const loadingOverlayTimeoutRef = useRef<number | null>(null);
  const [isInitialThreadRevealReady, setIsInitialThreadRevealReady] = useState(() => historyResolved);
  const [isLoadingOverlayVisible, setIsLoadingOverlayVisible] = useState(() => !historyResolved);
  const [isLoadingOverlayFadingOut, setIsLoadingOverlayFadingOut] = useState(false);

  const contentReady = historyResolved && !isLoading;
  const shouldHideThreadForInitialReveal =
    initialColdLoadRef.current && historyResolved && messages.length > 0 && !isInitialThreadRevealReady;
  const shouldShowColdLoadOverlay =
    !errorMessage && initialColdLoadRef.current && (!historyResolved || shouldHideThreadForInitialReveal);
  const threadReady = contentReady && !shouldHideThreadForInitialReveal;

  useEffect(() => {
    initialHandoffReadyRef.current = false;
    inputFocusReadyRef.current = false;
    initialColdLoadRef.current = !historyResolved;
    hasInitiallyRevealedRef.current = historyResolved;
    setIsInitialThreadRevealReady(historyResolved);
    if (revealAnimationFrameRef.current != null) {
      cancelAnimationFrame(revealAnimationFrameRef.current);
      revealAnimationFrameRef.current = null;
    }
    if (loadingOverlayTimeoutRef.current != null) {
      clearTimeout(loadingOverlayTimeoutRef.current);
      loadingOverlayTimeoutRef.current = null;
    }
    setIsLoadingOverlayVisible(!historyResolved);
    setIsLoadingOverlayFadingOut(false);
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

    // historyResolved && messages.length > 0 with cold-load active.
    // Trigger the reveal directly via the same double-rAF that
    // `handleInitialAnchorReady` would have done, instead of waiting on
    // ChatMessageList's `onInitialAnchorReady` callback. The child's
    // `useLayoutEffect` is keyed by `streamKey` and fires only ONCE per
    // (streamKey, hasMessages=true) pair: if `messages.length > 0` was
    // already true on first commit because the persisted `message-store`
    // thread for this `streamKey` carried over from a prior visit while
    // `historyResolved` was still false, the child's gate latches on a
    // no-op call (handleInitialAnchorReady bails on `!historyResolved`)
    // and never re-fires once history finally arrives -- leaving
    // `.messageContentHidden` (`visibility: hidden`) permanently applied
    // and rendering the chat panel as a black rectangle even though the
    // data is present (sidebar previews still show correctly because
    // `previewLastMessages` has its own 100-entry bound). This branch
    // closes that gap so the reveal is robust to either ordering of
    // `historyResolved` vs `messages.length > 0`.
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
      });
    });
  }, [historyResolved, messages.length]);

  useEffect(() => () => {
    if (revealAnimationFrameRef.current != null) {
      cancelAnimationFrame(revealAnimationFrameRef.current);
    }
    if (loadingOverlayTimeoutRef.current != null) {
      clearTimeout(loadingOverlayTimeoutRef.current);
    }
  }, []);

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
  }, [errorMessage, isLoadingOverlayFadingOut, isLoadingOverlayVisible, shouldShowColdLoadOverlay]);

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
      });
    });
  }, [historyResolved, messages.length]);

  useEffect(() => {
    if (!focusInputOnThreadReady || isMobileLayout || !threadReady || inputFocusReadyRef.current) {
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

  const emptyState = errorMessage ? (
    <div className={styles.emptyState}>
      <AlertCircle size={40} />
      <Text variant="muted" size="sm">{errorMessage}</Text>
    </div>
  ) : historyResolved && emptyMessage ? (
    <div className={styles.emptyState}>
      <MessageSquare size={40} />
      <Text variant="muted" size="sm">
        {emptyMessage}
      </Text>
    </div>
  ) : null;

  return (
    <div className={styles.container}>
      {header}
      <div className={styles.chatArea}>
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
                messages={messages}
                streamKey={streamKey}
                scrollRef={messageAreaRef}
                emptyState={emptyState}
                onLoadOlder={loadOlder}
                isLoadingOlder={isLoadingOlder}
                hasOlderMessages={hasOlderMessages}
                onInitialAnchorReady={handleInitialAnchorReady}
                isAutoFollowing={isAutoFollowing}
                density={isMobileLayout ? "mobile" : "desktop"}
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
              onMoveUp={handleQueueMoveUp}
              onRemove={handleQueueRemove}
            />
          </div>
        )}

        <ChatStreamingIndicator streamKey={streamKey} />

        {isThreadEmpty && (
          <PromptSuggestions onSelect={(prompt) => handleSend(prompt)} />
        )}

        <InputBarComponent
          ref={inputBarRef}
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          onStop={onStop}
          streamKey={streamKey}
          isExternallyBusy={isExternallyBusy}
          externalBusyMessage={externalBusyMessage}
          isQueued={isQueued}
          adapterType={adapterType}
          defaultModel={defaultModel}
          agentName={agentName}
          machineType={machineType}
          templateAgentId={templateAgentId}
          agentId={agentId}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onRemoveAttachment={handleRemoveAttachment}
          selectedCommands={commands}
          onCommandsChange={setCommands}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onProjectChange={onProjectChange}
          isVisible
          isCentered={isThreadEmpty}
          compact={compact}
          contextUsage={contextUsage}
          onNewSession={onNewSession}
        />
      </div>
    </div>
  );
}
