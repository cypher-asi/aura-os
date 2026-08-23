import {
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { track } from "../../../lib/analytics";
import { ContextUsageIndicator, type ContextBucketRowId } from "./ContextUsageIndicator";
import type { ContextUsageEntry } from "../../../stores/context-usage-store";
import {
  mapWireContextContents,
  useContextContentsStore,
} from "../../../stores/context-contents-store";
import { useSidekickStore } from "../../../stores/sidekick-store";
import type { ContextContentsResponse } from "../../../shared/api/agents";
import { useIsStreaming } from "../../../hooks/stream/hooks";
import { useFileAttachments } from "./useFileAttachments";
import type { GenerationMode } from "../../../constants/models";
import { modelSupportsQuality } from "../../../constants/models";
import { isGenerationCommand } from "../../../constants/commands";
import {
  AGENT_MODE_DESCRIPTORS,
  type AgentMode,
} from "../../../constants/modes";
import {
  InputBarShell,
  type InputBarShellHandle,
} from "../../../components/InputBarShell";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { MentionMenu } from "./MentionMenu";
import { useProjectFiles } from "./useProjectFiles";
import { useInputTriggers } from "./useInputTriggers";
import { useModelSelection } from "./useModelSelection";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { CommandChips } from "./CommandChips";
import { DemoRecordSettings } from "./DemoRecordSettings";
import { AttachmentPreviews } from "./AttachmentPreviews";
import { AttachControl } from "./AttachControl";
import { AgentInfoBar } from "./AgentInfoBar";
import { ChatModeBar } from "./ChatModeBar";
import { VoiceDictationControl } from "./VoiceDictationControl";
import { useVoiceDictation } from "./useVoiceDictation";
import {
  InputStatusHints,
  type InputStatusAction,
} from "./InputStatusHints";
import { ModelControls } from "./ModelControls";
import { ProjectPicker, type ProjectPickerOption } from "./ProjectPicker";
import { useChatUI } from "../../../stores/chat-ui-store";
import { useProfileStatusStore } from "../../../stores/profile-status-store";
import type { SlashCommand } from "../../../constants/commands";
import type { AgentInstance, Project } from "../../../shared/types";
import { MAX_AGENT_MENTIONS, type AgentMentionTarget } from "../../../api/streams";
import { isUserFacingAgentInstance } from "../../../components/ProjectList/project-list-shared";
import { filterRuntimeVisibleAgents } from "../../../shared/lib/agent-runtime-visibility";
import { resolveWorkspaceAccess } from "../../../shared/lib/workspace-access";
import { resolveAgentChatAvailability } from "../../../shared/lib/agent-chat-availability";
import {
  desktopApi,
  DEFAULT_DEMO_RECORD_OPTIONS,
  type DemoRecordOptions,
} from "../../../shared/api/desktop";
import styles from "./ChatInputBar.module.css";

export interface ChatInputBarHandle {
  focus: () => void;
  isFocused?: () => boolean;
}

/**
 * Lazily fetches the rendered text the harness counted for each static
 * context bucket. Built by the surface that owns the chat (agent- vs
 * instance-scoped — see `AgentChatPanel` / `useStandaloneAgentChat`) so
 * the input bar can stay agnostic about which endpoint variant applies,
 * mirroring how `useHydrateContextUtilization` receives its fetcher.
 */
export type ContextContentsFetcher = (
  signal?: AbortSignal,
) => Promise<ContextContentsResponse>;

export interface AttachmentItem {
  id: string;
  file: File;
  data: string;
  mediaType: string;
  name: string;
  attachmentType: "image" | "text";
  preview?: string;
  /** S3 URL after upload. When set, sent as source_url instead of base64. */
  fileUrl?: string;
  /** True while S3 upload is in flight. */
  uploading?: boolean;
  /** Upload progress 0-100. */
  uploadProgress?: number;
  /** Error message if S3 upload failed. Falls back to base64. */
  uploadError?: string;
}

export interface ChatInputBarProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: (
    content: string,
    action?: string,
    attachments?: AttachmentItem[],
    generationMode?: GenerationMode,
    agentMentions?: AgentMentionTarget[],
  ) => void;
  onStop: () => void;
  /** Ask a tool-free, ephemeral side question without mutating the main chat. */
  onAside?: (question: string) => void;
  streamKey: string;
  /**
   * Treat the input as busy even when the chat SSE is idle. Set when
   * an external source (e.g. an automation run against the same
   * upstream agent) is holding a turn and would cause the harness to
   * reject any new `UserMessage` with
   * "A turn is currently in progress; send cancel first". Shows the
   * stop icon so the user can cancel from the same affordance.
   */
  isExternallyBusy?: boolean;
  /**
   * Tooltip / disabled-reason explaining why the input is blocked.
   * Used only when `isExternallyBusy` is true, to surface "agent is
   * running an automation task" instead of the raw upstream string.
   */
  externalBusyMessage?: string;
  /**
   * True when the most recent send is queued behind another in-flight
   * turn on the same upstream agent partition (Phase 3 server signal:
   * `progress { stage: "queued" }`). Renders an inline hint that is
   * visually distinct from the generic busy state so the user
   * understands "your message is next" rather than "the agent is
   * blocked". Clears as soon as the actual turn delivers its first
   * delta — `progressText` is wiped by `handleTextDelta` /
   * `handleThinkingDelta` upstream.
   */
  isQueued?: boolean;
  /**
   * Optional override for the inline queued hint copy. Defaults to
   * "Queued behind current turn…".
   */
  queuedHint?: string;
  adapterType?: string;
  defaultModel?: string | null;
  machineType?: "local" | "remote";
  templateAgentId?: string;
  agentId?: string;
  attachments?: AttachmentItem[];
  onAttachmentsChange?: (items: AttachmentItem[]) => void;
  onRemoveAttachment?: (id: string) => void;
  selectedCommands?: SlashCommand[];
  onCommandsChange?: (commands: SlashCommand[]) => void;
  /**
   * Current `/record_demo` settings. Owned by the chat panel
   * (co-located with `selectedCommands`) so the send intercept can
   * read the same value the panel mutates. When omitted, the bar falls
   * back to a local copy seeded with the X-ready defaults so it still
   * renders standalone (e.g. in isolation tests).
   */
  demoRecordOptions?: DemoRecordOptions;
  onDemoRecordOptionsChange?: (options: DemoRecordOptions) => void;
  projects?: Project[];
  /** Lightweight switch targets when the active agent is bound to several projects. */
  projectPickerOptions?: readonly ProjectPickerOption[];
  selectedProjectId?: string;
  onProjectChange?: (projectId: string) => void;
  /**
   * Absolute path of the project's workspace on disk (or remote agent
   * filesystem). When set, typing `@` in the textarea opens the file
   * mention autocomplete; selecting a file reads it via the desktop /
   * remote-agent API and attaches it as a text attachment. Standalone
   * (project-less) chats omit this and the mention menu stays dormant.
   */
  workspacePath?: string;
  /**
   * When set, file reads for @-mention go through the swarm
   * remote-agent API instead of the local desktop API. Mirrors the
   * routing the file explorer uses.
   */
  remoteAgentId?: string;
  /** User-visible agents attached to this project for `@agent` delegation. */
  projectAgents?: AgentInstance[];
  /** Current project binding, excluded from the delegation picker. */
  currentAgentInstanceId?: string;
  isVisible?: boolean;
  isCentered?: boolean;
  /**
   * Opt the underlying `InputBarShell` out of its default
   * `position: absolute; bottom: 0` floating wrapper so the bar
   * participates in a normal flex/grid stack instead of docking to
   * the bottom of its scroll lane. Used by the public empty-state
   * compose surface so the heading + input + helper-tab stack can
   * vertically center as a single unit.
   */
  isStatic?: boolean;
  /**
   * Demo/static surfaces can drive the visible mode selector locally
   * without mutating the persisted chat UI store.
   */
  selectedModeOverride?: AgentMode;
  /**
   * Paired with `selectedModeOverride`; receives every explicit mode
   * pick, including re-clicks on the already active mode.
   */
  onSelectedModeOverrideChange?: (mode: AgentMode) => void;
  /** Render the prompt as controlled display text while keeping mode clicks live. */
  inputReadOnly?: boolean;
  contextUsage?: ContextUsageEntry;
  /**
   * Lazy fetcher for the Context Composition popover's bucket contents.
   * When set, clicking a breakdown row fetches + caches the bucket text
   * and opens it in the Sidekick preview. Omitted on surfaces that
   * can't resolve the right scope yet; the rows then stay inert.
   */
  onFetchContextContents?: ContextContentsFetcher;
  sendDisabled?: boolean;
  sendDisabledReason?: string;
  sendDisabledAction?: InputStatusAction;
  /**
   * Presentation copy for the same underlying chat runtime.
   * `chat` is used by the top-level Chat app; build/product surfaces
   * keep their creation-oriented prompts.
   */
  composerTone?: "build" | "chat";
  /**
   * Optional handler for the "+" new-chat button rendered at the
   * right end of the mode row (directly above the send button).
   * When provided, the button appears; when omitted, the mode row
   * renders `<ModeSelector>` exactly as before. This is the only
   * "reset / new conversation" affordance — the previous inline
   * RotateCcw context-reset button has been removed in favor of
   * routing all reset intent through the "+" / new-chat path.
   */
  onNewChat?: () => void;
  /**
   * Optional decorative node rendered behind the "+" glyph of the
   * bottom-left attach button, turning it into a circular, inset WebGL
   * well (the `<AuraScreenOrb />` field) with the "+" centered on top.
   * Opt-in so only the marketing mock LLM input on `/agents` pays for
   * an animated canvas; every real chat input leaves it unset and keeps
   * the shell's plain attach button.
   */
  attachAccent?: ReactNode;
}

// Stable module-level defaults: inline `= []` destructure defaults
// would mint a fresh array identity on every render whenever a caller
// leaves the prop undefined (marketing mocks, project-less chats),
// defeating the memoized slot components below on each keystroke.
const EMPTY_ATTACHMENTS: AttachmentItem[] = [];
const EMPTY_COMMANDS: SlashCommand[] = [];
const EMPTY_PROJECTS: Project[] = [];
const EMPTY_PROJECT_PICKER_OPTIONS: ProjectPickerOption[] = [];
const EMPTY_AGENT_INSTANCES: AgentInstance[] = [];
const CHAT_COMPOSER_MODE_LABELS: Partial<Record<AgentMode, string>> = {
  code: "Chat",
};

export const DesktopChatInputBar = memo(
  forwardRef<ChatInputBarHandle, ChatInputBarProps>(function DesktopChatInputBar(
    {
      input,
      onInputChange,
      onSend,
      onStop,
      onAside,
      streamKey,
      isExternallyBusy = false,
      externalBusyMessage,
      isQueued = false,
      queuedHint,
      adapterType,
      defaultModel,
      machineType,
      templateAgentId,
      agentId,
      attachments = EMPTY_ATTACHMENTS,
      onAttachmentsChange,
      onRemoveAttachment,
      selectedCommands = EMPTY_COMMANDS,
      onCommandsChange,
      demoRecordOptions,
      onDemoRecordOptionsChange,
      projects = EMPTY_PROJECTS,
      projectPickerOptions = EMPTY_PROJECT_PICKER_OPTIONS,
      selectedProjectId,
      onProjectChange,
      workspacePath,
      remoteAgentId,
      projectAgents = EMPTY_AGENT_INSTANCES,
      currentAgentInstanceId,
      isVisible = true,
      isCentered = false,
      isStatic = false,
      selectedModeOverride,
      onSelectedModeOverrideChange,
      inputReadOnly = false,
      contextUsage,
      onFetchContextContents,
      onNewChat,
      attachAccent,
      sendDisabled = false,
      sendDisabledReason,
      sendDisabledAction,
      composerTone = "build",
    },
    ref,
  ) {
    const isChatStreaming = useIsStreaming(streamKey);
    const isStreaming = isChatStreaming || isExternallyBusy;
    const { features, remoteOnly } = useAuraCapabilities();
    const chatUI = useChatUI(streamKey);
    const selectedModel = chatUI.selectedModel;
    const selectedEffort = chatUI.selectedEffort;
    const selectedMode = selectedModeOverride ?? chatUI.selectedMode;
    const effectiveSendDisabledAction =
      sendDisabledAction ??
      (sendDisabled && machineType === "local"
        ? { label: "Get desktop app", to: "/download" }
        : undefined);
    const imageQuality = chatUI.imageQuality;
    const councilCount = chatUI.councilCount;
    const councilModels = chatUI.councilModels;
    const councilMechanism = chatUI.councilMechanism;
    const answerStrategy = chatUI.answerStrategy;
    const secondOpinionReference = chatUI.secondOpinionReference;
    const setCouncilCount = chatUI.setCouncilCount;
    const setCouncilModel = chatUI.setCouncilModel;
    const setCouncilMechanism = chatUI.setCouncilMechanism;
    const setAnswerStrategy = chatUI.setAnswerStrategy;
    const setSecondOpinionReference = chatUI.setSecondOpinionReference;
    const setSelectedMode = chatUI.setSelectedMode;
    const clearGenerationCommands = useCallback(() => {
      if (onCommandsChange && selectedCommands.some((c) => isGenerationCommand(c.id))) {
        onCommandsChange(selectedCommands.filter((c) => !isGenerationCommand(c.id)));
      }
    }, [onCommandsChange, selectedCommands]);

    const onModeChange = useCallback(
      (mode: AgentMode) => {
        if (selectedModeOverride != null) return;
        setSelectedMode(streamKey, mode, adapterType, agentId);
        // Drop any conflicting generation chips so the chip row and
        // the mode selector never show contradicting intent.
        clearGenerationCommands();
        // Keep focus on the textarea so the user can immediately keep
        // typing after picking a mode. `SlidingPills` already prevents
        // the pill button from stealing focus on mousedown, so when the
        // textarea was already focused this is a no-op; the explicit
        // focus call covers the (more common) case where the user lands
        // on the centered empty-state surface and clicks a mode before
        // ever clicking the textarea.
        shellRef.current?.focus();
      },
      [
        adapterType,
        agentId,
        setSelectedMode,
        clearGenerationCommands,
        selectedModeOverride,
        streamKey,
      ],
    );
    const onModeSelect = useCallback(
      (mode: AgentMode) => {
        if (!onSelectedModeOverrideChange) return;
        onSelectedModeOverrideChange(mode);
        clearGenerationCommands();
        shellRef.current?.focus();
      },
      [clearGenerationCommands, onSelectedModeOverrideChange],
    );
    const handleOpenContextBucket = useCallback(
      (bucketId: ContextBucketRowId) => {
        // Open the preview immediately so the panel reflects the click
        // even before (or without) any harness contents; the empty
        // state covers the "not available yet" case.
        // TODO(phase4-followup): Modal fallback for surfaces without a
        // sidekick lane (standalone agent chat) — for now the Sidekick
        // preview store is the single open path.
        useSidekickStore.getState().viewContextBucket({ bucketId, streamKey });
        const fetcher = onFetchContextContents;
        if (!fetcher) return;
        void (async () => {
          try {
            const response = await fetcher();
            const mapped = mapWireContextContents(response.context_contents);
            if (mapped) {
              useContextContentsStore
                .getState()
                .setContextContents(streamKey, mapped);
            }
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            console.warn("Failed to load context bucket contents", err);
          }
        })();
      },
      [onFetchContextContents, streamKey],
    );
    const [isDragOver, setIsDragOver] = useState(false);
    // Driven by `<InputBarShell onMultiLineChange>` — flips to true the
    // moment the textarea wraps to a second visual row. Used to relocate
    // the model picker from the inline `inputRowEnd` slot (next to the
    // send button) into the `containerBottom` slot (a footer row inside
    // the rounded container) so the prompt can use the full width when
    // it grows tall.
    const [isMultiLine, setIsMultiLine] = useState(false);
    // Fallback store for the demo-record settings when the owner does
    // not lift them (controlled prop wins via `effectiveDemoOptions`).
    const [localDemoOptions, setLocalDemoOptions] = useState<DemoRecordOptions>(
      DEFAULT_DEMO_RECORD_OPTIONS,
    );
    const workspaceAccess = resolveWorkspaceAccess({
      workspacePath,
      remoteAgentId,
      linkedWorkspace: features.linkedWorkspace,
    });
    const mentionWorkspacePath = workspaceAccess.workspacePath;
    const remoteStatuses = useProfileStatusStore((state) => state.statuses);
    const registerRemoteAgents = useProfileStatusStore(
      (state) => state.registerRemoteAgents,
    );
    const projectRemoteAgents = useMemo(
      () =>
        projectAgents
          .filter((candidate) => candidate.machine_type === "remote")
          .map((candidate) => ({ agent_id: candidate.agent_id })),
      [projectAgents],
    );
    useEffect(() => {
      if (projectRemoteAgents.length > 0) {
        registerRemoteAgents(projectRemoteAgents);
      }
    }, [projectRemoteAgents, registerRemoteAgents]);
    const mentionableAgents = useMemo(
      () =>
        filterRuntimeVisibleAgents(projectAgents, remoteOnly)
          .filter(
            (candidate) =>
              candidate.agent_instance_id !== currentAgentInstanceId &&
              candidate.status !== "archived" &&
              isUserFacingAgentInstance(candidate),
          )
          .map((candidate) => {
            const availability = resolveAgentChatAvailability(
              candidate.machine_type,
              remoteStatuses[candidate.agent_id],
            );
            return {
              ...candidate,
              chatAvailable: availability.available,
              availabilityLabel: availability.label,
            };
          }),
      [currentAgentInstanceId, projectAgents, remoteOnly, remoteStatuses],
    );
    const canUseMentions = Boolean(mentionWorkspacePath) || mentionableAgents.length > 0;
    const infoBarWorkspacePath =
      workspaceAccess.canUseWorkspace || !workspacePath || remoteAgentId
        ? workspacePath
        : null;
    const shellRef = useRef<InputBarShellHandle>(null);
    const {
      supported: voiceSupported,
      listening: voiceListening,
      error: voiceError,
      start: startVoiceDictation,
      stop: stopVoiceDictation,
    } = useVoiceDictation(onInputChange);
    useImperativeHandle(ref, () => ({
      focus: () => shellRef.current?.focus(),
      isFocused: () => document.activeElement === shellRef.current?.getTextarea(),
    }));

    const textareaRefShim = useMemo(
      () => ({
        get current() {
          return shellRef.current?.getTextarea() ?? null;
        },
      }),
      [],
    );

    const { canAddMore, addFiles, addFileFromPath, handleRemove } = useFileAttachments(
      attachments,
      onAttachmentsChange,
      onRemoveAttachment,
      textareaRefShim as React.RefObject<HTMLTextAreaElement | null>,
      remoteAgentId,
    );
    const [agentMentionState, setAgentMentionState] = useState<{
      streamKey: string;
      mentions: Array<AgentMentionTarget & { name: string; token: string }>;
    }>(() => ({ streamKey, mentions: [] }));
    const selectedAgentMentions = useMemo(
      () =>
        agentMentionState.streamKey === streamKey
          ? agentMentionState.mentions.filter((mention) => input.includes(mention.token))
          : [],
      [agentMentionState, input, streamKey],
    );
    const selectableMentionAgents = useMemo(() => {
      if (selectedAgentMentions.length >= MAX_AGENT_MENTIONS) return [];
      const selectedIds = new Set(
        selectedAgentMentions.map((mention) => mention.agent_instance_id),
      );
      return mentionableAgents.filter(
        (candidate) => !selectedIds.has(candidate.agent_instance_id),
      );
    }, [mentionableAgents, selectedAgentMentions]);
    const updateMentionDraft = useCallback(
      (value: string) => {
        setAgentMentionState((current) => ({
          streamKey,
          mentions:
            current.streamKey === streamKey
              ? current.mentions.filter((mention) => value.includes(mention.token))
              : [],
        }));
        onInputChange(value);
      },
      [onInputChange, streamKey],
    );

    const recordAgentMention = useCallback(
      (candidate: { agent_id: string; agent_instance_id: string; name: string }) => {
        setAgentMentionState((current) => {
          const mentions = current.streamKey === streamKey ? current.mentions : [];
          if (
            mentions.length >= MAX_AGENT_MENTIONS ||
            mentions.some(
              (mention) => mention.agent_instance_id === candidate.agent_instance_id,
            )
          ) {
            return current;
          }
          return {
            streamKey,
            mentions: [
              ...mentions,
              {
                agent_id: candidate.agent_id,
                agent_instance_id: candidate.agent_instance_id,
                name: candidate.name,
                token: `@${candidate.name}`,
              },
            ],
          };
        });
        track("project_agent_mention_selected", {
          agent_id: candidate.agent_id,
          agent_instance_id: candidate.agent_instance_id,
        });
      },
      [streamKey],
    );

    // Generation slash commands (`/image` etc.) act as a keyboard path
    // to the mode selector; the trigger hook hands us the target mode
    // and we own the store write.
    const onSelectGenerationMode = useCallback(
      (mode: AgentMode) => {
        setSelectedMode(streamKey, mode, adapterType, agentId);
      },
      [setSelectedMode, streamKey, adapterType, agentId],
    );

    const {
      slashMenuOpen,
      slashQuery,
      mentionMenuOpen,
      mentionQuery,
      mentionRefreshNonce,
      handleInputChange,
      handleTextareaKeyDown,
      handleCommandSelect,
      handleSlashClose,
      handleMentionSelect,
      handleAgentMentionSelect,
      handleMentionClose,
    } = useInputTriggers({
      input,
      onInputChange: updateMentionDraft,
      shellRef,
      canUseMentions,
      selectedCommands,
      onCommandsChange,
      onSelectGenerationMode,
      addFileFromPath,
      onAgentMentionSelect: recordAgentMention,
    });

    const handleComposerInputChange = useCallback(
      (nextValue: string) => {
        // Manual typing owns the draft from this point forward. Stop first so
        // a late interim recognition result cannot overwrite the edit.
        if (voiceListening) stopVoiceDictation();
        handleInputChange(nextValue);
      },
      [handleInputChange, stopVoiceDictation, voiceListening],
    );

    useEffect(() => {
      if (isStreaming || sendDisabled || inputReadOnly) {
        stopVoiceDictation();
      }
    }, [inputReadOnly, isStreaming, sendDisabled, stopVoiceDictation]);

    const projectFiles = useProjectFiles({
      workspacePath: mentionWorkspacePath,
      remoteAgentId,
      refreshNonce: mentionRefreshNonce,
    });

    const selectedProject = projects.find(
      (p) => p.project_id === selectedProjectId,
    );

    // Drive the mode-derived UI state (model list filter, info-bar
    // hint copy, send pipeline) from the per-stream mode store. Slash
    // chips can no longer disagree with the selector because picking
    // `/image` / `/3d` calls `setSelectedMode` and switching modes
    // drops any conflicting chips.
    const modeBehavior = AGENT_MODE_DESCRIPTORS[selectedMode].behavior;
    const generationMode: GenerationMode =
      modeBehavior.kind === "generate_image"
        ? "image"
        : modeBehavior.kind === "generate_3d"
          ? "3d"
          : modeBehavior.kind === "generate_video"
            ? "video"
            : "chat";

    // 3D mode is a two-step in-bar pipeline (image step → model step,
    // see the `isThreeDMode` block below). Manual file attachments are
    // not a valid 3D source today (the router's data-URL path is
    // disabled, see `useChatStream`), so the Attach button, paste
    // image hijack, and drag-drop intake all early-return when 3D
    // mode is active. Other modes are unaffected.
    const handleDragOver = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (generationMode === "3d") return;
        setIsDragOver(true);
      },
      [generationMode],
    );
    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    }, []);
    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (generationMode === "3d") return;
        addFiles(e.dataTransfer.files);
      },
      [addFiles, generationMode],
    );

    const handlePaste = useCallback(
      (e: React.ClipboardEvent) => {
        if (generationMode === "3d") return;
        const items = e.clipboardData?.items;
        if (!items) return;
        const imageFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) imageFiles.push(file);
          }
        }
        if (imageFiles.length > 0) {
          e.preventDefault();
          const dt = new DataTransfer();
          imageFiles.forEach((f) => dt.items.add(f));
          addFiles(dt.files);
        }
      },
      [addFiles, generationMode],
    );
    const {
      modelsForMode,
      sortedModelsForMode,
      vendorGroups,
      shouldUseCondensedAuraMenu,
      isModelPickerInteractive,
      onModelChange,
      onImageQualityChange,
    } = useModelSelection({
      streamKey,
      adapterType,
      agentId,
      generationMode,
      setSelectedModel: chatUI.setSelectedModel,
      setImageQuality: chatUI.setImageQuality,
    });
    // Stable Set identity so `SlashCommandMenu`'s memo can bail out
    // between keystrokes while the menu is open (a fresh Set per render
    // used to defeat it on every character).
    const excludeIds = useMemo(
      () => {
        const ids = new Set(selectedCommands.map((c) => c.id));
        if (!onAside) ids.add("btw");
        return ids;
      },
      [onAside, selectedCommands],
    );

    const handleCommandRemove = useCallback(
      (id: string) => {
        onCommandsChange?.(selectedCommands.filter((c) => c.id !== id));
      },
      [selectedCommands, onCommandsChange],
    );

    const isRecordDemoActive = selectedCommands.some(
      (c) => c.id === "record_demo",
    );
    const effectiveDemoOptions = demoRecordOptions ?? localDemoOptions;
    const handleDemoOptionsChange = useCallback(
      (next: DemoRecordOptions) => {
        if (onDemoRecordOptionsChange) onDemoRecordOptionsChange(next);
        else setLocalDemoOptions(next);
      },
      [onDemoRecordOptionsChange],
    );
    const handlePickDemoBackground = useCallback(() => {
      void (async () => {
        try {
          const path = await desktopApi.pickFile();
          // A null path means the user cancelled the native picker.
          if (!path) return;
          handleDemoOptionsChange({
            ...effectiveDemoOptions,
            backgroundPath: path,
          });
        } catch {
          // Best-effort: the desktop picker is unavailable in the web build.
        }
      })();
    }, [effectiveDemoOptions, handleDemoOptionsChange]);

    // 3D mode is a two-step in-bar pipeline: with no source image
    // pinned, the user types a prompt and the first send runs the
    // AURA-styled image step (which then pins the result); with an
    // image pinned, the next send runs the image-to-3D conversion.
    // The pin lives in `chat-ui-store` so it persists across sends
    // and survives snapshot rehydrates.
    const isThreeDMode = generationMode === "3d";
    const pinnedSourceImage = chatUI.pinnedSourceImage;
    const has3DSource = isThreeDMode && pinnedSourceImage != null;
    const setPinnedSourceImage = chatUI.setPinnedSourceImage;
    const handleClearPinnedSource = useCallback(() => {
      setPinnedSourceImage(streamKey, null);
    }, [setPinnedSourceImage, streamKey]);

    const handleSubmit = useCallback(() => {
      stopVoiceDictation();
      if (sendDisabled) return;
      const asideSelected = selectedCommands.some(
        (command) => command.id === "btw",
      );
      if (asideSelected) {
        const question = input.trim();
        if (!question || !onAside) return;
        track("chat_side_question_sent");
        setAgentMentionState({ streamKey, mentions: [] });
        onCommandsChange?.(
          selectedCommands.filter((command) => command.id !== "btw"),
        );
        onInputChange("");
        onAside(question);
        return;
      }
      track("chat_message_sent", { model: selectedModel, mode: selectedMode });
      // Mode is read from the store inside `useChatPanelState.handleSend`;
      // we no longer need to thread `generationMode` through here.
      const targets = selectedAgentMentions.map(({ agent_id, agent_instance_id }) => ({
        agent_id,
        agent_instance_id,
      }));
      if (targets.length > 0) {
        track("project_agent_delegation_sent", { mention_count: targets.length });
        setAgentMentionState({ streamKey, mentions: [] });
        onSend(input, undefined, undefined, undefined, targets);
        return;
      }
      setAgentMentionState({ streamKey, mentions: [] });
      onSend(input, undefined, undefined);
    }, [
      input,
      onAside,
      onCommandsChange,
      onInputChange,
      onSend,
      selectedAgentMentions,
      selectedCommands,
      selectedModel,
      selectedMode,
      sendDisabled,
      stopVoiceDictation,
      streamKey,
    ]);

    const removeAgentMention = useCallback(
      (instanceId: string) => {
        const selected = selectedAgentMentions.find(
          (mention) => mention.agent_instance_id === instanceId,
        );
        if (!selected) return;
        setAgentMentionState((current) => ({
          streamKey,
          mentions: current.mentions.filter(
            (mention) => mention.agent_instance_id !== instanceId,
          ),
        }));
        onInputChange(input.replace(selected.token, "").replace(/ {2,}/g, " ").trimStart());
        shellRef.current?.focus();
      },
      [input, onInputChange, selectedAgentMentions, streamKey],
    );

    // Shared props for every `ModelControls` placement (inline /
    // bottom / mobile bar). The object literal is recreated per render,
    // but each individual prop is referentially stable while typing, so
    // the memoized `ModelControls` bails out of keystroke re-renders.
    const modelControlsProps = {
      streamKey,
      adapterType,
      defaultModel,
      generationMode,
      selectedModel,
      selectedEffort,
      imageQuality,
      councilCount,
      councilModels,
      councilMechanism,
      answerStrategy,
      secondOpinionReference,
      setCouncilCount,
      setCouncilModel,
      setCouncilMechanism,
      setAnswerStrategy,
      setSecondOpinionReference,
      sortedModelsForMode,
      vendorGroups,
      shouldUseCondensedAuraMenu,
      isModelPickerInteractive,
      onModelChange,
      onImageQualityChange,
    };

    const containerTop = (
      <>
        {slashMenuOpen && (
          <SlashCommandMenu
            query={slashQuery}
            excludeIds={excludeIds}
            onSelect={handleCommandSelect}
            onClose={handleSlashClose}
          />
        )}
        {mentionMenuOpen && canUseMentions && (
          <MentionMenu
            query={mentionQuery}
            agents={selectableMentionAgents}
            files={projectFiles}
            onSelectAgent={handleAgentMentionSelect}
            onSelectFile={handleMentionSelect}
            onClose={handleMentionClose}
          />
        )}
        {selectedAgentMentions.length > 0 ? (
          <div className={styles.agentMentionChips} aria-label="Agents included in this message">
            {selectedAgentMentions.map((mention) => (
              <span className={styles.agentMentionChip} key={mention.agent_instance_id}>
                <span aria-hidden="true">@</span>
                <strong>{mention.name}</strong>
                <button
                  type="button"
                  aria-label={`Remove ${mention.name}`}
                  onClick={() => removeAgentMention(mention.agent_instance_id)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <AttachmentPreviews
          attachments={attachments}
          onRemove={handleRemove}
        />
        {isRecordDemoActive ? (
          <DemoRecordSettings
            value={effectiveDemoOptions}
            onChange={handleDemoOptionsChange}
            onPickBackground={handlePickDemoBackground}
          />
        ) : null}
        <InputStatusHints
          isQueued={isQueued}
          queuedHint={queuedHint}
          sendDisabled={sendDisabled}
          sendDisabledReason={sendDisabledReason}
          sendDisabledAction={effectiveSendDisabledAction}
        />
        {modelsForMode.length > 0 ? (
          <ModelControls placement="mobileBar" {...modelControlsProps} />
        ) : null}
      </>
    );

    const inputRowStart = (
      <AttachControl
        isThreeDMode={isThreeDMode}
        pinnedSourceImage={isThreeDMode ? pinnedSourceImage : null}
        onClearPinnedSource={handleClearPinnedSource}
        isStatic={isStatic}
        attachAccent={attachAccent}
        canAttach={canAddMore && !sendDisabled}
        onFilesPicked={addFiles}
      />
    );

    // The model picker cluster has two homes depending on the
    // textarea's visual height:
    //   - Single-line: rendered inline inside `inputRowEnd`, hugged to
    //     the send button so the active model is glanceable next to
    //     the typing target.
    //   - Multi-line (or council fan-out / command chips): dropped into
    //     `containerBottom` so the prompt can use the full input width.
    const hasModelPicker = modelsForMode.length > 0;
    const showQualityPicker =
      generationMode === "image" && modelSupportsQuality(selectedModel);
    const hasPicker = hasModelPicker || showQualityPicker;
    // When the council fans out (>1 member) we always drop the pickers
    // into the bottom row so the N model slots get a full-width strip to
    // sit in, regardless of textarea height.
    const councilActive = councilCount > 1;
    const secondOpinionActive =
      generationMode === "chat" && answerStrategy === "second_opinion";
    // Command chips read as part of the prompt, but cramming them into
    // the narrow inline `inputRowEnd` slot truncates the label (e.g.
    // `/Record Demo` -> `/R…`). When any chip is present we expand the
    // bar: chips get their own full-width row and the model picker drops
    // to the bottom row so each sits on its own line, fully legible.
    const hasCommandChips = selectedCommands.length > 0;
    const showPickerInline =
      hasPicker &&
      !isMultiLine &&
      !councilActive &&
      !secondOpinionActive &&
      !hasCommandChips;
    const showPickerInBottomRow =
      hasPicker &&
      (isMultiLine || councilActive || secondOpinionActive || hasCommandChips);
    // State-independent version of `showPickerInline` for the shell's
    // wrap measurement: "would the picker sit inline if the prompt were
    // a single line?" must not vary with `isMultiLine` itself, or the
    // measurement reference would shift with the state it drives.
    const reserveInlineEnd =
      hasPicker && !councilActive && !secondOpinionActive && !hasCommandChips;
    const inputRowEnd = showPickerInline ? (
      <ModelControls placement="inline" {...modelControlsProps} />
    ) : null;
    const inputRowAction = !isStatic && voiceSupported ? (
      <VoiceDictationControl
        supported={voiceSupported}
        listening={voiceListening}
        error={voiceError}
        disabled={isStreaming || sendDisabled || inputReadOnly}
        onToggle={() => {
          if (voiceListening) stopVoiceDictation();
          else startVoiceDictation(input);
        }}
      />
    ) : null;
    // Bottom region stacks the tags row above the model ("LLM") row so a
    // tag like `/Record Demo` sits on its own line with full text, one
    // line below the prompt, and the model picker keeps its own line.
    const containerBottom =
      hasCommandChips || showPickerInBottomRow ? (
        <div className={styles.bottomStack}>
          {hasCommandChips ? (
            <CommandChips
              commands={selectedCommands}
              onRemove={handleCommandRemove}
              variant="stacked"
            />
          ) : null}
          {showPickerInBottomRow ? (
            <ModelControls placement="bottom" {...modelControlsProps} />
          ) : null}
        </div>
      ) : null;

    const infoBarStart = (
      <AgentInfoBar
        machineType={machineType}
        agentId={templateAgentId ?? agentId}
        workspacePath={infoBarWorkspacePath}
        project={selectedProject}
      />
    );

    const infoBarEnd = (
      <>
        <ProjectPicker
          projects={
            projectPickerOptions.length > 0 ? projectPickerOptions : projects
          }
          selectedProjectId={selectedProjectId}
          onProjectChange={onProjectChange}
        />
        {contextUsage != null && contextUsage.utilization > 0 ? (
          <ContextUsageIndicator
            utilization={contextUsage.utilization}
            estimatedTokens={contextUsage.estimatedTokens}
            breakdown={contextUsage.breakdown}
            model={contextUsage.model}
            provider={contextUsage.provider}
            cumulativeInputTokens={contextUsage.cumulativeInputTokens}
            cumulativeOutputTokens={contextUsage.cumulativeOutputTokens}
            cumulativeCacheReadTokens={contextUsage.cumulativeCacheReadTokens}
            cumulativeCacheCreationTokens={contextUsage.cumulativeCacheCreationTokens}
            onOpenBucket={handleOpenContextBucket}
          />
        ) : null}
      </>
    );

    const modeBar = (
      <ChatModeBar
        selectedMode={selectedMode}
        onModeChange={onModeChange}
        onModeSelect={onSelectedModeOverrideChange ? onModeSelect : undefined}
        modeLabels={
          composerTone === "chat" ? CHAT_COMPOSER_MODE_LABELS : undefined
        }
        onNewChat={onNewChat}
      />
    );

    // In 3D mode the bar is a two-step pipeline:
    //  - no thumb (image step): typed prompt becomes the seed for an
    //    AURA-styled image generation, so Send requires text.
    //  - thumb pinned (model step): textarea is optional refinement
    //    copy, so Send is always enabled (matches today's flow).
    // Other modes keep the historical "text or attachments or chips"
    // rule.
    const asideSelected = selectedCommands.some(
      (command) => command.id === "btw",
    );
    const isSendEnabled = asideSelected
      ? onAside != null && input.trim().length > 0
      : isThreeDMode
        ? has3DSource ||
          input.trim().length > 0 ||
          selectedCommands.length > 0
        : input.trim().length > 0 ||
          attachments.length > 0 ||
          selectedCommands.length > 0;
    const placeholder = isThreeDMode
      ? has3DSource
        ? "Refine your 3D model (optional)"
        : "Describe an image to generate\u2026"
      : selectedMode === "code" && !isStatic
        ? composerTone === "chat"
          ? "Ask Aura anything..."
          : "/ for commands, @ for context"
        : isCentered
          ? composerTone === "chat"
            ? "Ask Aura anything..."
            : "Describe what you want to create\u2026"
          : composerTone === "chat"
            ? "Ask Aura anything..."
            : "What do you want to create?";

    const isUploading = generationMode !== "image" && attachments.some((a) => a.uploading);

    // Stacked chrome in the `containerTop` slot (slash/mention menus,
    // attachments, the record-demo settings panel, queued/disabled hints)
    // makes the pill grow tall; flag that so the shell softens the fully
    // rounded pill to a normal rounded-rectangle radius instead of an oval.
    const inputExpanded =
      slashMenuOpen ||
      (mentionMenuOpen && canUseMentions) ||
      attachments.length > 0 ||
      isRecordDemoActive ||
      isQueued ||
      sendDisabled;

    return (
      <InputBarShell
        ref={shellRef}
        value={input}
        onValueChange={handleComposerInputChange}
        onSubmit={handleSubmit}
        onStop={onStop}
        isStreaming={isStreaming}
        disabled={isUploading || sendDisabled}
        isSendEnabled={!sendDisabled && isSendEnabled}
        isVisible={isVisible}
        isCentered={isCentered}
        centeredHeading={
          composerTone === "chat"
            ? "What can I help with?"
            : "What do you want to create?"
        }
        isStatic={isStatic}
        pill
        expanded={inputExpanded}
        isPulsing={isCentered}
        isDropZone={isDragOver}
        placeholder={placeholder}
        textareaProps={{
          "data-agent-field": "chat-input",
          readOnly: inputReadOnly || undefined,
          "aria-readonly": inputReadOnly ? "true" : undefined,
        }}
        onTextareaKeyDown={handleTextareaKeyDown}
        onTextareaPaste={handlePaste}
        onContainerDragOver={handleDragOver}
        onContainerDragLeave={handleDragLeave}
        onContainerDrop={handleDrop}
        modeBar={modeBar}
        containerTop={containerTop}
        containerBottom={containerBottom}
        inputRowStart={inputRowStart}
        inputRowEnd={inputRowEnd}
        inputRowAction={inputRowAction}
        reserveInlineEnd={reserveInlineEnd}
        infoBarStart={infoBarStart}
        infoBarEnd={infoBarEnd}
        onMultiLineChange={setIsMultiLine}
        sendAriaLabel="Send"
        stopAriaLabel={
          isExternallyBusy && !isChatStreaming ? "Stop automation" : "Stop"
        }
        stopTitle={
          isExternallyBusy && !isChatStreaming
            ? externalBusyMessage ?? "Stop the running automation"
            : undefined
        }
        rootProps={{ "data-agent-surface": "chat-input-bar" }}
      />
    );
  }),
);

export const ChatInputBar = DesktopChatInputBar;
