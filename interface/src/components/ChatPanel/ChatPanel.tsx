import { useEffect, useRef, type ReactNode } from "react";
import { MessageSquare, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { ChatMessageList } from "../ChatMessageList";
import { ChatInputBar } from "../ChatInputBar";
import { MessageQueue } from "../MessageQueue";
import { OverlayScrollbar } from "../OverlayScrollbar";
import { useChatPanelState } from "./useChatPanelState";
import { useChatViewportPhase } from "./useChatViewportPhase";
import type { ChatAttachment } from "../../api/streams";
import type { Project } from "../../types";
import type { GenerationMode } from "../../constants/models";
import type { DisplaySessionEvent } from "../../types/stream";
import styles from "./ChatPanel.module.css";

type ChatPanelHandoffMode = "create-agent";

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
  historyMessages?: DisplaySessionEvent[];
  projects?: Project[];
  selectedProjectId?: string;
  onProjectChange?: (projectId: string) => void;
  mobileHeaderAction?: ReactNode;
  onMobileHeaderSummaryClick?: () => void;
  mobileHeaderSummaryTo?: string;
  mobileHeaderSummaryHint?: string;
  mobileHeaderSummaryLabel?: string;
  mobileHeaderSummaryKind?: "details" | "switch";
  initialHandoff?: ChatPanelHandoffMode;
  onInitialHandoffReady?: () => void;
  contextUtilization?: number;
  onNewSession?: () => void;
}

export function ChatPanel({
  streamKey,
  onSend,
  onStop,
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
  historyMessages,
  projects,
  selectedProjectId,
  onProjectChange,
  mobileHeaderAction,
  onMobileHeaderSummaryClick,
  mobileHeaderSummaryTo,
  mobileHeaderSummaryHint,
  mobileHeaderSummaryLabel,
  mobileHeaderSummaryKind = "details",
  initialHandoff,
  onInitialHandoffReady,
  contextUtilization,
  onNewSession,
}: ChatPanelProps) {
  const showLoadingState = isLoading;
  const s = useChatPanelState({
    streamKey,
    onSend,
    adapterType,
    defaultModel,
    scrollResetKey,
    historyMessages,
    selectedProjectId,
  });
  const { isReady: chromeReady } = useChatViewportPhase({
    contentReady: historyResolved,
    hasMessages: s.messages.length > 0,
    tailLayoutReady: s.tailLayoutReady,
    layoutRevision: s.tailLayoutRevision,
    resetKey: scrollResetKey,
    scrollToBottom: s.scrollToBottom,
    containerRef: s.messageAreaRef,
    sentinelRef: s.scrollSentinelRef,
  });
  const initialHandoffReadyRef = useRef(false);
  const inputFocusReadyRef = useRef(false);
  const hideMessageContent = s.messages.length > 0 && !chromeReady;

  useEffect(() => {
    initialHandoffReadyRef.current = false;
    inputFocusReadyRef.current = false;
  }, [initialHandoff, scrollResetKey]);

  useEffect(() => {
    if (s.isMobileLayout || !chromeReady || inputFocusReadyRef.current) {
      return;
    }
    inputFocusReadyRef.current = true;
    requestAnimationFrame(() => s.inputBarRef.current?.focus());
  }, [chromeReady, s.inputBarRef, s.isMobileLayout]);

  useEffect(() => {
    if (!initialHandoff || !chromeReady || initialHandoffReadyRef.current) {
      return;
    }
    initialHandoffReadyRef.current = true;
    onInitialHandoffReady?.();
  }, [chromeReady, initialHandoff, onInitialHandoffReady]);

  const emptyState = errorMessage ? (
    <div className={styles.emptyState}>
      <AlertCircle size={40} />
      <Text variant="muted" size="sm">{errorMessage}</Text>
    </div>
  ) : showLoadingState ? null : historyResolved ? (
    <div className={styles.emptyState}>
      <MessageSquare size={40} />
      <Text variant="muted" size="sm">
        {emptyMessage ?? `Start chatting with ${agentName ?? "this agent"}.`}
      </Text>
    </div>
  ) : null;

  return (
    <div className={styles.container}>
      {s.isMobileLayout && agentName ? (
        <div className={styles.projectAgentBar}>
          <div className={styles.projectAgentSummary}>
            {onMobileHeaderSummaryClick || mobileHeaderSummaryTo ? (
              mobileHeaderSummaryTo ? (
                <Link
                  to={mobileHeaderSummaryTo}
                  className={styles.projectAgentSummaryButton}
                  aria-label={mobileHeaderSummaryLabel ?? `Open details for ${agentName}`}
                >
                  <div className={styles.projectAgentSummaryCopy}>
                    <span className={styles.projectAgentName}>{agentName}</span>
                    <span className={styles.projectAgentSummaryHint}>
                      {mobileHeaderSummaryHint
                        ?? (machineType === "remote" ? "Open skills and runtime" : "Open agent settings")}
                    </span>
                  </div>
                  <span className={styles.projectAgentSummaryChevron} aria-hidden="true">
                    {mobileHeaderSummaryKind === "switch" ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                </Link>
              ) : (
                <button
                  type="button"
                  className={styles.projectAgentSummaryButton}
                  onClick={onMobileHeaderSummaryClick}
                  aria-label={mobileHeaderSummaryLabel ?? `Open details for ${agentName}`}
                >
                  <div className={styles.projectAgentSummaryCopy}>
                    <span className={styles.projectAgentName}>{agentName}</span>
                    <span className={styles.projectAgentSummaryHint}>
                      {mobileHeaderSummaryHint
                        ?? (machineType === "remote" ? "Open skills and runtime" : "Open agent settings")}
                    </span>
                  </div>
                  <span className={styles.projectAgentSummaryChevron} aria-hidden="true">
                    {mobileHeaderSummaryKind === "switch" ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                </button>
              )
            ) : (
              <div className={styles.projectAgentSummaryCopy}>
                <span className={styles.projectAgentName}>{agentName}</span>
                <span className={styles.projectAgentSummaryHint}>
                  {machineType === "remote" ? "Remote agent chat" : "Local agent chat"}
                </span>
              </div>
            )}
            {mobileHeaderAction ? (
              <div className={styles.projectAgentAction}>
                {mobileHeaderAction}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className={styles.chatArea}>
        <div className={styles.messageAreaShell}>
          <div
            className={`${styles.messageArea}${s.isAutoFollowing ? ` ${styles.messageAreaFollowing}` : ` ${styles.messageAreaReading}`}`}
            ref={s.messageAreaRef}
            onScroll={s.handleScroll}
          >
            <div
              className={`${styles.messageContent}${hideMessageContent ? ` ${styles.messageContentSettling}` : ""}`}
              aria-hidden={hideMessageContent}
            >
              <ChatMessageList
                messages={s.messages}
                streamKey={streamKey}
                scrollRef={s.messageAreaRef}
                emptyState={emptyState}
                onTailLayoutChange={s.handleTailLayoutChange}
              />
              <div ref={s.scrollSentinelRef} className={styles.scrollSentinel} />
            </div>
          </div>
          <OverlayScrollbar scrollRef={s.messageAreaRef} />
        </div>

        {s.queue.length > 0 && (
          <div className={styles.queueSection}>
            <MessageQueue
              streamKey={streamKey}
              onEdit={s.handleQueueEdit}
              onMoveUp={s.handleQueueMoveUp}
              onRemove={s.handleQueueRemove}
            />
          </div>
        )}

        <ChatInputBar
          ref={s.inputBarRef}
          input={s.input}
          onInputChange={s.setInput}
          onSend={s.handleSend}
          onStop={onStop}
          streamKey={streamKey}
          adapterType={adapterType}
          defaultModel={defaultModel}
          agentName={agentName}
          machineType={machineType}
          templateAgentId={templateAgentId}
          agentId={agentId}
          attachments={s.attachments}
          onAttachmentsChange={s.setAttachments}
          onRemoveAttachment={s.handleRemoveAttachment}
          selectedCommands={s.commands}
          onCommandsChange={s.setCommands}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onProjectChange={onProjectChange}
          isVisible
          contextUtilization={contextUtilization}
          onNewSession={onNewSession}
        />
      </div>
    </div>
  );
}
