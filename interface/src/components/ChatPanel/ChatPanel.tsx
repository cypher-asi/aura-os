import { useEffect, useRef, type ReactNode } from "react";
import { MessageSquare, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { ChatMessageList } from "../ChatMessageList";
import { ChatInputBar } from "../ChatInputBar";
import { MessageQueue } from "../MessageQueue";
import { OverlayScrollbar } from "../OverlayScrollbar";
import { useChatPanelState } from "./useChatPanelState";
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
    queue,
    messages,
    scrollToBottom,
    heightCache,
    onContentHeightChange,
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
    historyMessages,
    selectedProjectId,
    agentId,
  });

  const initialHandoffReadyRef = useRef(false);
  const inputFocusReadyRef = useRef(false);
  const showLoadingPlaceholder =
    !errorMessage && messages.length === 0 && (showLoadingState || !historyResolved);

  const contentReady = historyResolved && !isLoading;

  useEffect(() => {
    initialHandoffReadyRef.current = false;
    inputFocusReadyRef.current = false;
  }, [initialHandoff, scrollResetKey]);

  useEffect(() => {
    if (isMobileLayout || !contentReady || inputFocusReadyRef.current) {
      return;
    }
    inputFocusReadyRef.current = true;
    requestAnimationFrame(() => inputBarRef.current?.focus());
  }, [contentReady, inputBarRef, isMobileLayout]);

  useEffect(() => {
    if (!initialHandoff || !contentReady || initialHandoffReadyRef.current) {
      return;
    }
    initialHandoffReadyRef.current = true;
    onInitialHandoffReady?.();
  }, [contentReady, initialHandoff, onInitialHandoffReady]);

  const emptyState = errorMessage ? (
    <div className={styles.emptyState}>
      <AlertCircle size={40} />
      <Text variant="muted" size="sm">{errorMessage}</Text>
    </div>
  ) : showLoadingPlaceholder ? (
    <div className={styles.emptyState}>
      <MessageSquare size={40} />
      <Text variant="muted" size="sm">Loading conversation...</Text>
    </div>
  ) : historyResolved ? (
    <div className={styles.emptyState}>
      <MessageSquare size={40} />
      <Text variant="muted" size="sm">
        {emptyMessage ?? `Start chatting with ${agentName ?? "this agent"}.`}
      </Text>
    </div>
  ) : null;

  return (
    <div className={styles.container}>
      {isMobileLayout && agentName ? (
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
            className={`${styles.messageArea}${isAutoFollowing ? ` ${styles.messageAreaFollowing}` : ` ${styles.messageAreaReading}`}`}
            ref={messageAreaRef}
            onScroll={handleScroll}
          >
            <div className={styles.messageContent}>
              <ChatMessageList
                messages={messages}
                streamKey={streamKey}
                scrollRef={messageAreaRef}
                emptyState={emptyState}
                heightCache={heightCache}
                onLoadOlder={loadOlder}
                isLoadingOlder={isLoadingOlder}
                hasOlderMessages={hasOlderMessages}
                onContentHeightChange={onContentHeightChange}
              />
            </div>
          </div>
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

        <ChatInputBar
          ref={inputBarRef}
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          onStop={onStop}
          streamKey={streamKey}
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
          contextUtilization={contextUtilization}
          onNewSession={onNewSession}
        />
      </div>
    </div>
  );
}
