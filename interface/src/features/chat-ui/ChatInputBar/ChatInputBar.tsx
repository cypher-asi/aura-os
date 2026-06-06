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
import {
  Plus,
  X,
  FileText,
  ChevronDown,
  FolderOpen,
} from "lucide-react";
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
import type {
  GenerationMode,
  ImageQuality,
  ModelEffort,
  ModelVendor,
} from "../../../constants/models";
import {
  availableModelsForAdapter,
  groupChatModelsByVendor,
  IMAGE_QUALITY_OPTIONS,
  modelLabelWithEffort,
  getModelsForMode,
  modelSupportsQuality,
  sortModelsForMenu,
} from "../../../constants/models";
import { isGenerationCommand } from "../../../constants/commands";
import {
  AGENT_MODE_DESCRIPTORS,
  type AgentMode,
} from "../../../constants/modes";
import { AgentEnvironment } from "../../../apps/agents/components/AgentEnvironment";
import { OrbitStatusIndicator } from "../../../components/OrbitStatusIndicator";
import {
  InputBarShell,
  inputBarShellStyles,
  ModelPicker,
  ModelMenuRow,
  ModelMenuGroup,
  ModelMenuScroll,
  CouncilCountRow,
  CouncilMechanismRow,
  ModeSelector,
  type InputBarShellHandle,
} from "../../../components/InputBarShell";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { FileMentionMenu } from "./FileMentionMenu";
import { useProjectFiles } from "./useProjectFiles";
import { CommandChips } from "./CommandChips";
import { DemoRecordSettings } from "./DemoRecordSettings";
import { useChatUI } from "../../../stores/chat-ui-store";
import type { SlashCommand } from "../../../constants/commands";
import type { Project } from "../../../shared/types";
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
  ) => void;
  onStop: () => void;
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
  agentName?: string;
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
  /**
   * Reserved for compact-layout tweaks (e.g. floating desktop agent
   * windows where the chat surface can be very narrow). Currently a
   * no-op now that the info-bar slash hint has been removed; kept on
   * the public props so callers (`ChatPanel`, `AgentWindow`) don't
   * need to be touched if a future compact affordance is added.
   */
  compact?: boolean;
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
   * bottom-left attach button, turning the chrome disc into a circular,
   * inset WebGL well (the `<AuraScreenOrb />` field) with the "+" centered
   * on top. Opt-in so only the marketing mock LLM input on `/agents`
   * pays for an animated canvas; every real chat input leaves it unset
   * and keeps the standard `attachRing` chrome.
   */
  attachAccent?: ReactNode;
}

function AttachmentPreviews({
  attachments,
  onRemove,
}: {
  attachments: AttachmentItem[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className={styles.attachmentPreviews}>
      {attachments.map((a) => (
        <div key={a.id} className={styles.attachmentThumb} style={a.uploading ? { opacity: 0.5 } : undefined}>
          {a.preview ? (
            <img src={a.preview} alt="" className={styles.attachmentThumbImg} />
          ) : (
            <FileText size={20} className={styles.attachmentFileIcon} />
          )}
          <span className={styles.attachmentName}>{a.name}</span>
          <button
            type="button"
            className={styles.attachmentRemove}
            onClick={() => onRemove(a.id)}
            aria-label="Remove attachment"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export const DesktopChatInputBar = memo(
  forwardRef<ChatInputBarHandle, ChatInputBarProps>(function DesktopChatInputBar(
    {
      input,
      onInputChange,
      onSend,
      onStop,
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
      attachments = [],
      onAttachmentsChange,
      onRemoveAttachment,
      selectedCommands = [],
      onCommandsChange,
      demoRecordOptions,
      onDemoRecordOptionsChange,
      projects = [],
      selectedProjectId,
      onProjectChange,
      workspacePath,
      remoteAgentId,
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
    },
    ref,
  ) {
    const isChatStreaming = useIsStreaming(streamKey);
    const isStreaming = isChatStreaming || isExternallyBusy;
    const chatUI = useChatUI(streamKey);
    const selectedModel = chatUI.selectedModel;
    const selectedEffort = chatUI.selectedEffort;
    const selectedMode = selectedModeOverride ?? chatUI.selectedMode;
    const imageQuality = chatUI.imageQuality;
    const councilCount = chatUI.councilCount;
    const councilModels = chatUI.councilModels;
    const councilMechanism = chatUI.councilMechanism;
    const setCouncilCount = chatUI.setCouncilCount;
    const setCouncilModel = chatUI.setCouncilModel;
    const setCouncilMechanism = chatUI.setCouncilMechanism;
    const onModelChange = useCallback(
      (model: string, effort?: ModelEffort) => {
        chatUI.setSelectedModel(streamKey, model, adapterType, agentId, effort);
      },
      [chatUI.setSelectedModel, streamKey, adapterType, agentId],
    );
    const onImageQualityChange = useCallback(
      (quality: ImageQuality) => {
        chatUI.setImageQuality(streamKey, quality, agentId);
      },
      [chatUI.setImageQuality, streamKey, agentId],
    );
    const clearGenerationCommands = useCallback(() => {
      if (onCommandsChange && selectedCommands.some((c) => isGenerationCommand(c.id))) {
        onCommandsChange(selectedCommands.filter((c) => !isGenerationCommand(c.id)));
      }
    }, [onCommandsChange, selectedCommands]);

    const onModeChange = useCallback(
      (mode: AgentMode) => {
        if (selectedModeOverride != null) return;
        chatUI.setSelectedMode(streamKey, mode, adapterType, agentId);
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
        chatUI.setSelectedMode,
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
    // Collapses the mode-selector pills from the top mode bar, leaving the
    // balanced chevron (left) / new-chat "+" (right) affordances in place.
    const [modesCollapsed, setModesCollapsed] = useState(false);
    // Collapsed vendor sections in the chat model picker. Empty = all
    // expanded (the default whenever the picker opens).
    const [collapsedVendors, setCollapsedVendors] = useState<Set<ModelVendor>>(
      () => new Set(),
    );
    const [projectMenuOpen, setProjectMenuOpen] = useState(false);
    // Which inline picker (model vs image-quality) is currently open.
    // Holding a single value here keeps the two dropdowns mutually
    // exclusive so opening one closes the other.
    const [openPicker, setOpenPicker] = useState<"model" | "quality" | null>(
      null,
    );
    // Which AURA Council slot picker (if any) is open, so only one slot
    // menu is mounted at a time when the council fans out into multiple
    // bottom-row pickers (Task B). `null` = none open.
    const [openCouncilSlot, setOpenCouncilSlot] = useState<number | null>(null);
    // Driven by `<InputBarShell onMultiLineChange>` — flips to true the
    // moment the textarea wraps to a second visual row. Used to relocate
    // the model picker from the inline `inputRowEnd` slot (next to the
    // send button) into the `containerBottom` slot (a footer row inside
    // the rounded container) so the prompt can use the full width when
    // it grows tall.
    const [isMultiLine, setIsMultiLine] = useState(false);
    const [slashMenuOpen, setSlashMenuOpen] = useState(false);
    const [slashQuery, setSlashQuery] = useState("");
    // Fallback store for the demo-record settings when the owner does
    // not lift them (controlled prop wins via `effectiveDemoOptions`).
    const [localDemoOptions, setLocalDemoOptions] = useState<DemoRecordOptions>(
      DEFAULT_DEMO_RECORD_OPTIONS,
    );
    const slashStartRef = useRef<number | null>(null);
    const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
    const [mentionQuery, setMentionQuery] = useState("");
    const [mentionRefreshNonce, setMentionRefreshNonce] = useState(0);
    const mentionStartRef = useRef<number | null>(null);
    const canUseMentions = Boolean(workspacePath);
    const projectFiles = useProjectFiles({
      workspacePath: canUseMentions ? workspacePath : undefined,
      remoteAgentId,
      refreshNonce: mentionRefreshNonce,
    });
    const projectMenuRef = useRef<HTMLDivElement>(null);
    const shellRef = useRef<InputBarShellHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
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

    useEffect(() => {
      if (!projectMenuOpen) return;
      const onClickOutside = (e: MouseEvent) => {
        if (
          projectMenuRef.current &&
          !projectMenuRef.current.contains(e.target as Node)
        ) {
          setProjectMenuOpen(false);
        }
      };
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }, [projectMenuOpen]);

    const selectedProject = projects.find(
      (p) => p.project_id === selectedProjectId,
    );
    const selectedProjectName = selectedProject?.name;

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
    // In chat mode, let the (only) `aura_harness` adapter drive the available
    // model list. In image/3d mode, use the mode-filtered model list (image/3d
    // generation is provider-agnostic today).
    const modelsForMode =
      generationMode === "chat"
        ? availableModelsForAdapter(adapterType)
        : getModelsForMode(generationMode);
    const sortedModelsForMode = useMemo(
      () => sortModelsForMenu(modelsForMode),
      [modelsForMode],
    );
    const shouldUseCondensedAuraMenu =
      generationMode === "chat" &&
      (!adapterType || adapterType === "aura_harness");
    // Ordered, non-empty vendor sections (Anthropic / OpenAI / Open
    // Source today) for the collapsible chat picker.
    const vendorGroups = useMemo(
      () => groupChatModelsByVendor(modelsForMode),
      [modelsForMode],
    );
    const toggleVendor = useCallback((vendor: ModelVendor) => {
      setCollapsedVendors((prev) => {
        const next = new Set(prev);
        if (next.has(vendor)) {
          next.delete(vendor);
        } else {
          next.add(vendor);
        }
        return next;
      });
    }, []);

    const excludeIds = new Set(selectedCommands.map((c) => c.id));

    const handleCommandSelect = useCallback(
      (cmd: SlashCommand) => {
        if (isGenerationCommand(cmd.id)) {
          // Slash command becomes a fast keyboard path to the mode
          // selector. The mode itself injects the matching command
          // id at send time, so we don't add a redundant chip.
          const targetMode: AgentMode =
            cmd.id === "generate_image" ? "image" :
            cmd.id === "generate_video" ? "video" :
            "3d";
          chatUI.setSelectedMode(streamKey, targetMode, adapterType, agentId);
        } else {
          onCommandsChange?.([...selectedCommands, cmd]);
        }
        if (slashStartRef.current !== null) {
          const before = input.slice(0, slashStartRef.current);
          const afterSlash = input.slice(slashStartRef.current);
          const spaceIdx = afterSlash.indexOf(" ");
          const after = spaceIdx === -1 ? "" : afterSlash.slice(spaceIdx + 1);
          onInputChange(before + after);
        }
        setSlashMenuOpen(false);
        setSlashQuery("");
        slashStartRef.current = null;
        shellRef.current?.focus();
      },
      [
        adapterType,
        agentId,
        chatUI.setSelectedMode,
        input,
        onCommandsChange,
        onInputChange,
        selectedCommands,
        streamKey,
      ],
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

    const handleInputChange = useCallback(
      (value: string) => {
        onInputChange(value);
        const el = shellRef.current?.getTextarea();
        if (!el) return;
        const cursor = el.selectionStart;
        const textBefore = value.slice(0, cursor);
        const slashMatch = textBefore.match(/(^|\s)\/(\S*)$/);
        if (slashMatch) {
          slashStartRef.current = textBefore.lastIndexOf("/");
          setSlashQuery(slashMatch[2]);
          setSlashMenuOpen(true);
        } else if (slashMenuOpen) {
          setSlashMenuOpen(false);
          setSlashQuery("");
          slashStartRef.current = null;
        }

        // @-mention detection mirrors the slash-menu trigger shape but
        // is only armed when the surrounding chat is project-scoped
        // (workspacePath is set). The two menus are mutually exclusive
        // in practice — `@` and `/` are different leading tokens — so
        // no tie-breaking is needed here.
        if (canUseMentions) {
          const mentionMatch = textBefore.match(/(^|\s)@(\S*)$/);
          if (mentionMatch) {
            const wasClosed = !mentionMenuOpen;
            mentionStartRef.current = textBefore.lastIndexOf("@");
            setMentionQuery(mentionMatch[2]);
            setMentionMenuOpen(true);
            // Refresh the file listing the moment the menu opens so
            // newly-created files show up without waiting for the
            // explorer's 3s polling loop.
            if (wasClosed) setMentionRefreshNonce((n) => n + 1);
          } else if (mentionMenuOpen) {
            setMentionMenuOpen(false);
            setMentionQuery("");
            mentionStartRef.current = null;
          }
        }
      },
      [canUseMentions, mentionMenuOpen, onInputChange, slashMenuOpen],
    );

    const handleTextareaKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (
          (slashMenuOpen || mentionMenuOpen) &&
          ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)
        ) {
          // The slash / mention menu owns these keys while open;
          // preventDefault tells the shell not to treat Enter as submit.
          e.preventDefault();
        }
      },
      [slashMenuOpen, mentionMenuOpen],
    );

    const handleMentionSelect = useCallback(
      (file: { path: string; name: string }) => {
        // Strip the `@query` token from the input the same way the
        // slash menu strips its `/cmd` token, then push the file into
        // the attachment pipeline (S3 upload starts in the background).
        if (mentionStartRef.current !== null) {
          const before = input.slice(0, mentionStartRef.current);
          const afterAt = input.slice(mentionStartRef.current);
          const spaceIdx = afterAt.indexOf(" ");
          const after = spaceIdx === -1 ? "" : afterAt.slice(spaceIdx + 1);
          onInputChange(before + after);
        }
        setMentionMenuOpen(false);
        setMentionQuery("");
        mentionStartRef.current = null;
        void addFileFromPath(file.path);
      },
      [input, onInputChange, addFileFromPath],
    );

    const handleMentionClose = useCallback(() => {
      setMentionMenuOpen(false);
      setMentionQuery("");
      mentionStartRef.current = null;
    }, []);

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
      if (sendDisabled) return;
      track("chat_message_sent", { model: selectedModel, mode: selectedMode });
      // Mode is read from the store inside `useChatPanelState.handleSend`;
      // we no longer need to thread `generationMode` through here.
      onSend(input, undefined, undefined);
    }, [input, onSend, selectedModel, selectedMode, sendDisabled]);

    // Parametrized model-menu renderer shared by the single model
    // picker and (Task B) the per-slot council pickers. `activeModelId`
    // / `activeEffort` drive the row highlight, `onSelect` writes the
    // pick, and `includeCouncilRow` prepends the AURA Council count row
    // at the very top of the menu (single picker only — slot menus are
    // single-select and must not recurse the count row into themselves).
    const renderModelMenuList = useCallback(
      (
        close: () => void,
        cfg: {
          activeModelId: string | null;
          activeEffort: ModelEffort | null;
          onSelect: (modelId: string, effort?: ModelEffort) => void;
          includeCouncilRow: boolean;
        },
      ) => {
        const councilRow = cfg.includeCouncilRow ? (
          <CouncilCountRow
            key="__council_count__"
            count={councilCount}
            onSelect={(n) => setCouncilCount(streamKey, n)}
          />
        ) : null;
        // Combine-mechanism picker sits directly under the count row and
        // is only relevant once the council fans out (`count > 1`).
        const mechanismRow =
          cfg.includeCouncilRow && councilCount > 1 ? (
            <CouncilMechanismRow
              key="__council_mechanism__"
              mechanism={councilMechanism}
              onSelect={(m) => setCouncilMechanism(streamKey, m)}
            />
          ) : null;
        if (shouldUseCondensedAuraMenu) {
          return (
            <ModelMenuScroll
              lockWidth
              data-agent-surface="model-picker"
              data-agent-proof="chat-model-picker-visible"
            >
              {councilRow}
              {mechanismRow}
              {vendorGroups.map((group) => (
                <ModelMenuGroup
                  key={group.vendor}
                  label={group.label}
                  collapsed={collapsedVendors.has(group.vendor)}
                  onToggle={() => toggleVendor(group.vendor)}
                >
                  {group.models.map((m) => (
                    <ModelMenuRow
                      key={m.id}
                      model={m}
                      isActive={m.id === cfg.activeModelId}
                      activeEffort={cfg.activeEffort}
                      onSelect={(id, effort) => {
                        cfg.onSelect(id, effort);
                        close();
                      }}
                    />
                  ))}
                </ModelMenuGroup>
              ))}
            </ModelMenuScroll>
          );
        }
        return (
          <ModelMenuScroll
            data-agent-surface="model-picker"
            data-agent-proof="chat-model-picker-visible"
          >
            {councilRow}
            {mechanismRow}
            {sortedModelsForMode.map((m) => {
              const isComingSoon = m.id.startsWith("dreamina-seedance");
              return (
                <ModelMenuRow
                  key={m.id}
                  model={m}
                  isActive={m.id === cfg.activeModelId}
                  activeEffort={cfg.activeEffort}
                  disabled={isComingSoon}
                  labelSuffix={isComingSoon ? " (coming soon)" : undefined}
                  onSelect={(id, effort) => {
                    cfg.onSelect(id, effort);
                    close();
                  }}
                />
              );
            })}
          </ModelMenuScroll>
        );
      },
      [
        shouldUseCondensedAuraMenu,
        vendorGroups,
        collapsedVendors,
        toggleVendor,
        sortedModelsForMode,
        councilCount,
        setCouncilCount,
        councilMechanism,
        setCouncilMechanism,
        streamKey,
      ],
    );

    const renderModelMenuItems = useCallback(
      (close: () => void) =>
        renderModelMenuList(close, {
          activeModelId: selectedModel,
          activeEffort: selectedEffort,
          onSelect: (id, effort) => onModelChange(id, effort),
          includeCouncilRow: true,
        }),
      [renderModelMenuList, selectedModel, selectedEffort, onModelChange],
    );

    const isModelPickerInteractive = modelsForMode.length > 1;
    // Expand every vendor section each time the picker reopens, so a
    // user who collapsed sections last time still sees the full list.
    // `ModelPicker` itself keeps the caret focused in the textarea via
    // mousedown preventDefault, so we deliberately do NOT blur the
    // shell here — switching models should leave the user's typing
    // position intact.
    const handleModelPickerOpen = useCallback(() => {
      setCollapsedVendors(new Set());
    }, []);

    const containerTop = (
      <>
        {slashMenuOpen && (
          <SlashCommandMenu
            query={slashQuery}
            excludeIds={excludeIds}
            onSelect={handleCommandSelect}
            onClose={() => {
              setSlashMenuOpen(false);
              setSlashQuery("");
              slashStartRef.current = null;
            }}
          />
        )}
        {mentionMenuOpen && canUseMentions && (
          <FileMentionMenu
            query={mentionQuery}
            files={projectFiles}
            onSelect={handleMentionSelect}
            onClose={handleMentionClose}
          />
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="*/*"
          multiple
          className={inputBarShellStyles.fileInputHidden}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
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
        {isQueued ? (
          <div
            className={styles.queuedHint}
            role="status"
            aria-live="polite"
            data-agent-surface="chat-input-queued-hint"
          >
            <span className={styles.queuedHintDot} aria-hidden="true" />
            <span className={styles.queuedHintLabel}>
              {queuedHint ?? "Queued behind current turn\u2026"}
            </span>
          </div>
        ) : null}
        {sendDisabled ? (
          <div
            className={styles.queuedHint}
            role="status"
            aria-live="polite"
            data-agent-surface="chat-input-disabled-hint"
          >
            <span className={styles.queuedHintLabel}>
              {sendDisabledReason ?? "This is a local agent and can only be used in the desktop app."}
            </span>
          </div>
        ) : null}
        {modelsForMode.length > 0 ? (
          <div className={inputBarShellStyles.mobileModelBar}>
            <span className={inputBarShellStyles.mobileModelLabel}>Model</span>
            <ModelPicker
              selectedLabel={modelLabelWithEffort(
                selectedModel ?? "",
                selectedEffort,
                adapterType,
                defaultModel,
              )}
              isInteractive={isModelPickerInteractive}
              renderMenu={renderModelMenuItems}
              className={inputBarShellStyles.mobileModelMenuWrap}
              buttonClassName={inputBarShellStyles.mobileModelButton}
              showChevron={isModelPickerInteractive}
            />
          </div>
        ) : null}
      </>
    );

    // In 3D mode the attach affordance is replaced by the auto-derived
    // "Source for 3D" thumb (rendered inline at the start of the input
    // row when an image is pinned). Keeping it inline — instead of
    // stacking it above the textarea — preserves the input row's
    // height so the pinned `ChatStreamingIndicator` ("Generating 3D
    // model...") remains visible.
    const inputRowStart =
      generationMode === "3d" ? (
        has3DSource && pinnedSourceImage ? (
          <div
            className={`${inputBarShellStyles.attachButton} ${styles.sourceImageInline}`}
            data-agent-surface="chat-input-3d-source-thumb"
            data-agent-proof="3d-source-image-ready"
            title={pinnedSourceImage.prompt || "Source for 3D generation"}
          >
            <img
              className={styles.sourceImageInlineImg}
              src={pinnedSourceImage.imageUrl}
              alt={pinnedSourceImage.prompt || "Source for 3D generation"}
            />
            <button
              type="button"
              className={styles.sourceImageInlineRemove}
              onClick={handleClearPinnedSource}
              aria-label="Remove source image"
            >
              <X size={9} />
            </button>
          </div>
        ) : null
      ) : (
        <button
          type="button"
          className={`${inputBarShellStyles.attachButton} ${
            attachAccent ? styles.attachOrb : styles.attachRing
          }`}
          onClick={() => fileInputRef.current?.click()}
          disabled={!canAddMore || sendDisabled}
          aria-label="Attach file"
        >
          {attachAccent ? (
            <span className={styles.attachOrbField} aria-hidden="true">
              {attachAccent}
            </span>
          ) : null}
          <Plus size={23} strokeWidth={1} />
        </button>
      );

    // The model picker has two homes depending on the textarea's
    // visual height:
    //   - Single-line: rendered inline inside `inputRowEnd`, hugged to
    //     the send button so the active model is glanceable next to
    //     the typing target.
    //   - Multi-line: dropped into `containerBottom` (a footer row
    //     inside the rounded container), left-aligned past the attach
    //     button — matches the reference layout in the design and
    //     frees the full input width for the prompt.
    // Slash-command chips always stay inline in `inputRowEnd` because
    // they read as part of the prompt itself, not as global chrome.
    const hasModelPicker = modelsForMode.length > 0;
    const modelPickerNode = hasModelPicker ? (
      <ModelPicker
        selectedLabel={modelLabelWithEffort(
          selectedModel ?? "",
          selectedEffort,
          adapterType,
          defaultModel,
        )}
        isInteractive={isModelPickerInteractive}
        renderMenu={renderModelMenuItems}
        onOpen={handleModelPickerOpen}
        open={openPicker === "model"}
        onOpenChange={(o) => setOpenPicker(o ? "model" : null)}
        triggerProps={{ "data-agent-action": "open-model-picker" }}
        className={styles.inlineModelPicker}
      />
    ) : null;

    // Image-quality picker: only meaningful in Image mode for models
    // that expose a quality knob (GPT Image). Sits next to the model
    // picker and reuses the same dropdown chrome.
    const showQualityPicker =
      generationMode === "image" && modelSupportsQuality(selectedModel);
    const activeQualityLabel =
      IMAGE_QUALITY_OPTIONS.find((q) => q.id === imageQuality)?.label ??
      imageQuality;
    const renderQualityMenuItems = useCallback(
      (close: () => void) => (
        <div
          className={inputBarShellStyles.modelMenu}
          data-agent-surface="image-quality-picker"
          data-agent-proof="image-quality-picker-visible"
        >
          {IMAGE_QUALITY_OPTIONS.map((q) => (
            <button
              key={q.id}
              type="button"
              className={`${inputBarShellStyles.modelMenuItem} ${
                q.id === imageQuality
                  ? inputBarShellStyles.modelMenuItemActive
                  : ""
              }`}
              onClick={() => {
                onImageQualityChange(q.id);
                close();
              }}
            >
              <span className={inputBarShellStyles.modelMenuItemLabel}>
                {q.label}
              </span>
            </button>
          ))}
        </div>
      ),
      [imageQuality, onImageQualityChange],
    );
    const qualityPickerNode = showQualityPicker ? (
      <ModelPicker
        selectedLabel={`Quality: ${activeQualityLabel}`}
        isInteractive
        renderMenu={renderQualityMenuItems}
        open={openPicker === "quality"}
        onOpenChange={(o) => setOpenPicker(o ? "quality" : null)}
        triggerProps={{ "data-agent-action": "open-quality-picker" }}
        className={styles.inlineModelPicker}
      />
    ) : null;
    const hasPicker = hasModelPicker || showQualityPicker;
    // When the council fans out (>1 member) we always drop the pickers
    // into the bottom row so the N model slots get a full-width strip to
    // sit in, regardless of textarea height.
    const councilActive = councilCount > 1;
    // Command chips read as part of the prompt, but cramming them into
    // the narrow inline `inputRowEnd` slot truncates the label (e.g.
    // `/Record Demo` -> `/R…`). When any chip is present we expand the
    // bar: chips get their own full-width row and the model picker drops
    // to the bottom row so each sits on its own line, fully legible.
    const hasCommandChips = selectedCommands.length > 0;
    const showPickerInline =
      hasPicker && !isMultiLine && !councilActive && !hasCommandChips;
    const showPickerInBottomRow =
      hasPicker && (isMultiLine || councilActive || hasCommandChips);
    // One ModelPicker per council member, each bound to its own slot
    // (slot 0 is the synthesizer). Every slot reuses `renderModelMenuList`
    // including the council count row so the AURA Council control stays
    // reachable from any model selector once the council has fanned out
    // into multiple slots.
    const councilSlotNodes =
      councilActive && hasModelPicker
        ? Array.from({ length: councilCount }, (_, slot) => {
            const member = councilModels[slot];
            const slotModelId = member?.id ?? selectedModel ?? "";
            const slotEffort = member?.effort ?? null;
            return (
              <div key={slot} className={styles.councilSlot}>
                <ModelPicker
                  selectedLabel={modelLabelWithEffort(
                    slotModelId,
                    slotEffort,
                    adapterType,
                    defaultModel,
                  )}
                  isInteractive={isModelPickerInteractive}
                  renderMenu={(close) =>
                    renderModelMenuList(close, {
                      activeModelId: slotModelId,
                      activeEffort: slotEffort,
                      onSelect: (id, effort) =>
                        setCouncilModel(streamKey, slot, id, effort),
                      includeCouncilRow: true,
                    })
                  }
                  onOpen={handleModelPickerOpen}
                  open={openCouncilSlot === slot}
                  onOpenChange={(o) => setOpenCouncilSlot(o ? slot : null)}
                  triggerProps={{
                    "data-agent-action": "open-council-slot",
                    "data-council-slot": slot,
                  }}
                  className={styles.inlineModelPicker}
                />
              </div>
            );
          })
        : null;
    // Chips no longer live in the inline slot; the slot now only carries
    // the single-line model/quality picker hugged to the send button.
    const hasInputRowEnd = showPickerInline;
    const inputRowEnd = hasInputRowEnd ? (
      <>
        {showPickerInline ? modelPickerNode : null}
        {showPickerInline ? qualityPickerNode : null}
      </>
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
            <div
              className={
                councilActive
                  ? `${styles.bottomChromeRow} ${styles.councilSlotsRow}`
                  : styles.bottomChromeRow
              }
              data-agent-surface={councilActive ? "council-slots" : undefined}
            >
              {councilActive ? councilSlotNodes : modelPickerNode}
              {qualityPickerNode}
            </div>
          ) : null}
        </div>
      ) : null;

    // Only render the "·" divider when the orbit indicator on the
    // right will actually paint something. `OrbitStatusIndicator`
    // returns null whenever there is no project, so without this gate
    // we end up with a hanging dot between two invisible neighbours
    // (the inert AgentEnvironment placeholder on the left and the
    // null orbit indicator on the right) — most visibly on the
    // logged-out chat surface and "General" / projectless chats.
    const showInfoDivider = selectedProject != null;
    const infoBarStart = (
      <>
        <span className={styles.environmentWrap}>
          <AgentEnvironment
            machineType={machineType}
            agentId={templateAgentId ?? agentId}
            workspacePath={workspacePath}
          />
        </span>
        {showInfoDivider ? (
          <span className={styles.infoDivider} aria-hidden="true">
            ·
          </span>
        ) : null}
        <span className={styles.orbitWrap}>
          <OrbitStatusIndicator project={selectedProject} />
        </span>
      </>
    );

    // Hide the project chip entirely when there is nothing to scope
    // to AND no projects to switch into. On the public (logged-out)
    // chat surface neither `projects` nor `onProjectChange` are
    // wired, so `usePublicChat` previously rendered a static
    // "General" pill that was both inert and slightly misleading
    // ("General" is an authenticated-shell concept). Authenticated
    // chats keep the chip even with no current selection so the
    // visitor can still choose a project from the dropdown.
    const showProjectChip = projects.length > 0 || selectedProject != null;
    const infoBarEnd = (
      <>
        {showProjectChip ? (
          <div className={styles.projectMenuWrap} ref={projectMenuRef}>
            <button
              type="button"
              className={styles.projectButton}
              onClick={
                projects.length > 0 && onProjectChange
                  ? () => setProjectMenuOpen((v) => !v)
                  : undefined
              }
              style={
                projects.length > 0 && onProjectChange
                  ? undefined
                  : { cursor: "default" }
              }
            >
              <FolderOpen size={10} />
              {selectedProjectName ?? "General"}
              {projects.length > 0 && onProjectChange && (
                <ChevronDown size={10} />
              )}
            </button>
            {projectMenuOpen && projects.length > 0 && onProjectChange && (
              <div className={styles.projectMenu}>
                {projects.map((p) => (
                  <button
                    key={p.project_id}
                    type="button"
                    className={`${styles.projectMenuItem} ${p.project_id === selectedProjectId ? styles.projectMenuItemActive : ""}`}
                    onClick={() => {
                      onProjectChange(p.project_id);
                      setProjectMenuOpen(false);
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
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

    const modeBar = onNewChat ? (
      <div className={styles.modeBarRow}>
        <button
          type="button"
          className={styles.modeCollapseButton}
          onClick={() => setModesCollapsed((v) => !v)}
          title={modesCollapsed ? "Show modes" : "Hide modes"}
          aria-label={modesCollapsed ? "Show modes" : "Hide modes"}
          aria-expanded={!modesCollapsed}
          data-agent-action="toggle-modes"
        >
          <ChevronDown
            size={16}
            strokeWidth={1.5}
            className={
              modesCollapsed
                ? `${styles.modeChevron} ${styles.modeChevronCollapsed}`
                : styles.modeChevron
            }
          />
        </button>
        {modesCollapsed ? null : (
          <ModeSelector
            selectedMode={selectedMode}
            onChange={onModeChange}
            onSelect={onSelectedModeOverrideChange ? onModeSelect : undefined}
            className={styles.modeSelectorFlex}
          />
        )}
        <button
          type="button"
          className={styles.modeNewChatButton}
          onClick={onNewChat}
          title="Start a new chat"
          aria-label="Start new chat"
          data-agent-action="start-new-chat"
        >
          {/* Match the bottom-left attach button's glyph so both `+`
              affordances on the LLM input are visually identical. */}
          <Plus size={16} strokeWidth={1} />
        </button>
      </div>
    ) : (
      <ModeSelector
        selectedMode={selectedMode}
        onChange={onModeChange}
        onSelect={onSelectedModeOverrideChange ? onModeSelect : undefined}
        className={styles.modeSelectorDetached}
      />
    );

    // In 3D mode the bar is a two-step pipeline:
    //  - no thumb (image step): typed prompt becomes the seed for an
    //    AURA-styled image generation, so Send requires text.
    //  - thumb pinned (model step): textarea is optional refinement
    //    copy, so Send is always enabled (matches today's flow).
    // Other modes keep the historical "text or attachments or chips"
    // rule.
    const isSendEnabled = isThreeDMode
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
        ? "/ for commands, @ for context"
        : isCentered
          ? "Describe what you want to create\u2026"
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
        onValueChange={handleInputChange}
        onSubmit={handleSubmit}
        onStop={onStop}
        isStreaming={isStreaming}
        disabled={isUploading || sendDisabled}
        isSendEnabled={!sendDisabled && isSendEnabled}
        isVisible={isVisible}
        isCentered={isCentered}
        centeredHeading="What do you want to create?"
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
