import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type ForwardRefExoticComponent,
  type ReactNode,
  type RefAttributes,
} from "react";
import { ChatSurface } from "./ChatSurface";
import { SubAgentSurface } from "./SubAgentSurface";
import { ChatPanelStreamContext } from "./chat-panel-context";
import {
  DesktopChatInputBar,
  type ChatInputBarHandle,
  type ChatInputBarProps,
  type ContextContentsFetcher,
} from "../ChatInputBar";
import {
  useSubAgentPane,
  useSubAgentPaneActions,
} from "../../../stores/subagent-pane-store";
import type { AgentMentionTarget, ChatAttachment } from "../../../api/streams";
import type { AgentInstance, Project } from "../../../shared/types";
import type { GenerationMode } from "../../../constants/models";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import type { ContextUsageEntry } from "../../../stores/context-usage-store";
import type { SessionBoundary } from "../../../hooks/use-prior-sessions";
import type { LoadOlderPageFetcher } from "../../../hooks/use-load-older-messages";
import type { ProjectPickerOption } from "../ChatInputBar/ProjectPicker";
import styles from "./ChatPanel.module.css";

type ChatPanelHandoffMode = "create-agent";

// Fallback for clearing the exiting overlay if the slide-out
// `animationend` never fires (e.g. the layer is detached before the
// keyframe completes). Slightly longer than the CSS duration.
const SUBAGENT_EXIT_FALLBACK_MS = 360;

export interface ChatPanelProps {
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
  onAside?: (question: string) => Promise<string>;
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
  projectPickerOptions?: readonly ProjectPickerOption[];
  selectedProjectId?: string;
  /**
   * Project id sent as `body.project_id` on the wire. Defaults to
   * `selectedProjectId` when omitted. The agents-app passes a
   * different value here so the picker's static "Home" label can
   * stay while the LLM still receives the correct context project.
   */
  llmProjectId?: string;
  onProjectChange?: (projectId: string) => void;
  /**
   * Workspace path of the active project (or remote agent). Forwarded
   * to the input bar so `@`-typed file mentions can resolve against
   * the project's file tree.
   */
  workspacePath?: string;
  /**
   * When set, the input bar reads mentioned files via the remote-agent
   * filesystem API instead of the local desktop API.
   */
  remoteAgentId?: string;
  projectAgents?: AgentInstance[];
  currentAgentInstanceId?: string;
  header?: ReactNode;
  InputBarComponent?: ForwardRefExoticComponent<
    ChatInputBarProps & RefAttributes<ChatInputBarHandle>
  >;
  initialHandoff?: ChatPanelHandoffMode;
  onInitialHandoffReady?: () => void;
  contextUsage?: ContextUsageEntry;
  /** Lazy fetcher for the Context Composition popover's bucket
   * contents, forwarded to the input bar via {@link ChatSurface}. */
  onFetchContextContents?: ContextContentsFetcher;
  composerTone?: ChatInputBarProps["composerTone"];
  /**
   * Optional ChatGPT-style "+" new-chat handler. When set, the input
   * bar shows a small Plus button that wipes the visible transcript and
   * arms the next send to create a fresh session.
   */
  onNewChat?: () => void;
  sendDisabled?: boolean;
  sendDisabledReason?: string;
  /** Loads the chronologically previous session above the current chat. */
  onLoadPriorSession?: () => void;
  /** Whether an older session exists to load above the current chat. */
  hasPriorSession?: boolean;
  isLoadingPriorSession?: boolean;
  /** Per-session dividers for the prepended prior sessions. */
  sessionBoundaries?: SessionBoundary[];
  /** Fetches one older history page for this thread (cursor-paginated). */
  loadOlderPage?: LoadOlderPageFetcher;
}

/**
 * Layered chat surface. The parent thread renders as a persistent base
 * layer; opening a `task` card's subagent pushes a second `ChatSurface`
 * over it as an absolutely-positioned slide-over (iOS-style push
 * navigation). The base layer never remounts or resizes, so the parent
 * content stays put underneath while the subagent slides in and back
 * out. Keyed by THIS panel's `streamKey` via the pane store so
 * independent surfaces never collide.
 */
export function ChatPanel({
  streamKey: parentStreamKey,
  transcriptKey,
  onSend,
  onStop,
  onAside,
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
  projectPickerOptions,
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
  onLoadPriorSession,
  hasPriorSession,
  isLoadingPriorSession,
  sessionBoundaries,
  loadOlderPage,
}: ChatPanelProps) {
  const subagentPane = useSubAgentPane(parentStreamKey);
  const { closePane } = useSubAgentPaneActions();

  // Closing keeps the pane in the store (so the overlay stays mounted)
  // while the slide-out plays; the store entry is dropped on the
  // animation's `animationend` (or a fallback timer). All state writes
  // happen in event handlers, never in an effect.
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const finishClose = useCallback(() => {
    clearCloseTimer();
    setIsClosing(false);
    closePane(parentStreamKey);
  }, [clearCloseTimer, closePane, parentStreamKey]);

  const handleCloseSubagent = useCallback(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      closePane(parentStreamKey);
      return;
    }
    setIsClosing(true);
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(
      finishClose,
      SUBAGENT_EXIT_FALLBACK_MS,
    );
  }, [clearCloseTimer, closePane, finishClose, parentStreamKey]);

  const handleOverlayAnimationEnd = useCallback(
    (event: ReactAnimationEvent<HTMLDivElement>) => {
      // Ignore animations bubbling up from descendants (badge pulse,
      // streaming shimmer, etc.); only the surface root's own slide-out
      // signals the transition is complete.
      if (event.target !== event.currentTarget) return;
      if (isClosing) finishClose();
    },
    [isClosing, finishClose],
  );

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  const paneToRender = subagentPane;
  const isExiting = isClosing && !!subagentPane;
  const overlayClassName = `${styles.subagentLayer} ${
    isExiting ? styles.subagentSlideOut : styles.subagentSlideIn
  }`;
  const baseClassName = `${styles.baseLayer}${
    subagentPane && !isClosing ? ` ${styles.baseLayerPushed}` : ""
  }`;

  return (
    <ChatPanelStreamContext.Provider value={parentStreamKey}>
      <div className={styles.container}>
        <ChatSurface
          className={baseClassName}
          header={header}
          streamKey={parentStreamKey}
          transcriptKey={transcriptKey}
          onSend={onSend}
          onStop={onStop}
          onAside={onAside}
          isExternallyBusy={isExternallyBusy}
          externalBusyMessage={externalBusyMessage}
          agentName={agentName}
          machineType={machineType}
          adapterType={adapterType}
          defaultModel={defaultModel}
          templateAgentId={templateAgentId}
          agentId={agentId}
          isLoading={isLoading}
          historyResolved={historyResolved}
          errorMessage={errorMessage}
          emptyMessage={emptyMessage}
          scrollResetKey={scrollResetKey}
          scrollToBottomOnReset={scrollToBottomOnReset}
          focusInputOnThreadReady={focusInputOnThreadReady}
          historyMessages={historyMessages}
          projects={projects}
          projectPickerOptions={projectPickerOptions}
          selectedProjectId={selectedProjectId}
          llmProjectId={llmProjectId}
          onProjectChange={onProjectChange}
          workspacePath={workspacePath}
          remoteAgentId={remoteAgentId}
          projectAgents={projectAgents}
          currentAgentInstanceId={currentAgentInstanceId}
          InputBarComponent={InputBarComponent}
          initialHandoff={initialHandoff}
          onInitialHandoffReady={onInitialHandoffReady}
          contextUsage={contextUsage}
          onFetchContextContents={onFetchContextContents}
          composerTone={composerTone}
          onNewChat={onNewChat}
          sendDisabled={sendDisabled}
          sendDisabledReason={sendDisabledReason}
          onLoadPriorSession={onLoadPriorSession}
          hasPriorSession={hasPriorSession}
          isLoadingPriorSession={isLoadingPriorSession}
          sessionBoundaries={sessionBoundaries}
          loadOlderPage={loadOlderPage}
        />
        {paneToRender && (
          <SubAgentSurface
            key={paneToRender.childRunId}
            descriptor={paneToRender}
            agentName={agentName}
            onBack={handleCloseSubagent}
            className={overlayClassName}
            onAnimationEnd={handleOverlayAnimationEnd}
            adapterType={adapterType}
            defaultModel={defaultModel}
            agentId={agentId}
            templateAgentId={templateAgentId}
            machineType={machineType}
            projects={projects}
            selectedProjectId={selectedProjectId}
            onProjectChange={onProjectChange}
            workspacePath={workspacePath}
            remoteAgentId={remoteAgentId}
            contextUsage={contextUsage}
            InputBarComponent={InputBarComponent}
          />
        )}
      </div>
    </ChatPanelStreamContext.Provider>
  );
}
