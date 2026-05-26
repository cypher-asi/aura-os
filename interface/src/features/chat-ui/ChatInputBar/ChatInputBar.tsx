import {
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  Plus,
  X,
  FileText,
  ChevronDown,
  FolderOpen,
  Video,
} from "lucide-react";
import { track } from "../../../lib/analytics";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import type { ContextUsageEntry } from "../../../stores/context-usage-store";
import { useIsStreaming } from "../../../hooks/stream/hooks";
import { useFileAttachments } from "./useFileAttachments";
import type { GenerationMode } from "../../../constants/models";
import {
  availableModelsForAdapter,
  modelLabel,
  getModelsForMode,
  modelProviderGroup,
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
  ModeSelector,
  type InputBarShellHandle,
} from "../../../components/InputBarShell";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { FileMentionMenu } from "./FileMentionMenu";
import { useProjectFiles } from "./useProjectFiles";
import { CommandChips } from "./CommandChips";
import { useChatUI } from "../../../stores/chat-ui-store";
import type { SlashCommand } from "../../../constants/commands";
import type { Project } from "../../../shared/types";
import { useAgentAvatarStore } from "../../../stores/agent-avatar-store";
import styles from "./ChatInputBar.module.css";

export interface ChatInputBarHandle {
  focus: () => void;
  isFocused?: () => boolean;
}

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
   * Reserved for compact-layout tweaks (e.g. floating desktop agent
   * windows where the chat surface can be very narrow). Currently a
   * no-op now that the info-bar slash hint has been removed; kept on
   * the public props so callers (`ChatPanel`, `AgentWindow`) don't
   * need to be touched if a future compact affordance is added.
   */
  compact?: boolean;
  contextUsage?: ContextUsageEntry;
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
      projects = [],
      selectedProjectId,
      onProjectChange,
      workspacePath,
      remoteAgentId,
      isVisible = true,
      isCentered = false,
      contextUsage,
      onNewChat,
    },
    ref,
  ) {
    const isChatStreaming = useIsStreaming(streamKey);
    const isStreaming = isChatStreaming || isExternallyBusy;
    const chatUI = useChatUI(streamKey);
    const selectedModel = chatUI.selectedModel;
    const selectedMode = chatUI.selectedMode;
    const onModelChange = useCallback(
      (model: string) => {
        chatUI.setSelectedModel(streamKey, model, adapterType, agentId);
      },
      [chatUI.setSelectedModel, streamKey, adapterType, agentId],
    );
    const onModeChange = useCallback(
      (mode: AgentMode) => {
        chatUI.setSelectedMode(streamKey, mode, adapterType, agentId);
        // Drop any conflicting generation chips so the chip row and
        // the mode selector never show contradicting intent.
        if (onCommandsChange && selectedCommands.some((c) => isGenerationCommand(c.id))) {
          onCommandsChange(selectedCommands.filter((c) => !isGenerationCommand(c.id)));
        }
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
        onCommandsChange,
        selectedCommands,
        streamKey,
      ],
    );
    const [isDragOver, setIsDragOver] = useState(false);
    const [showAllModels, setShowAllModels] = useState(false);
    const [projectMenuOpen, setProjectMenuOpen] = useState(false);
    // Driven by `<InputBarShell onMultiLineChange>` — flips to true the
    // moment the textarea wraps to a second visual row. Used to relocate
    // the model picker from the inline `inputRowEnd` slot (next to the
    // send button) into the `containerBottom` slot (a footer row inside
    // the rounded container) so the prompt can use the full width when
    // it grows tall.
    const [isMultiLine, setIsMultiLine] = useState(false);
    const [slashMenuOpen, setSlashMenuOpen] = useState(false);
    const [slashQuery, setSlashQuery] = useState("");
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
    const avatarWindowOpen = useAgentAvatarStore((s) => s.windowOpen);
    const toggleAvatarWindow = useAgentAvatarStore((s) => s.toggleWindow);
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
    const featuredModelIds = useMemo(
      () =>
        new Set([
          "aura-gpt-5-5",
          "aura-gpt-5-4",
          "aura-gpt-5-4-mini",
          "aura-claude-opus-4-7",
          "aura-claude-sonnet-4-6",
        ]),
      [],
    );
    const featuredModels = useMemo(
      () =>
        sortedModelsForMode.filter((model) => featuredModelIds.has(model.id)),
      [featuredModelIds, sortedModelsForMode],
    );
    const hiddenModels = useMemo(
      () =>
        sortedModelsForMode.filter((model) => !featuredModelIds.has(model.id)),
      [featuredModelIds, sortedModelsForMode],
    );
    const groupedExpandedModels = useMemo(() => {
      const groups = new Map<string, typeof sortedModelsForMode>();
      for (const model of sortedModelsForMode) {
        const key = modelProviderGroup(model);
        const existing = groups.get(key) ?? [];
        existing.push(model);
        groups.set(key, existing);
      }
      return groups;
    }, [sortedModelsForMode]);

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
      track("chat_message_sent", { model: selectedModel, mode: selectedMode });
      // Mode is read from the store inside `useChatPanelState.handleSend`;
      // we no longer need to thread `generationMode` through here.
      onSend(input, undefined, undefined);
    }, [input, onSend, selectedModel, selectedMode]);

    const providerLabel = (provider: string): string => {
      switch (provider) {
        case "aura":
          return "Aura";
        case "image":
          return "Image";
        case "3d":
          return "3D";
        default:
          return "Other";
      }
    };

    const renderModelMenuItems = useCallback(
      (close: () => void) => {
        if (shouldUseCondensedAuraMenu && !showAllModels) {
          return (
            <div
              className={inputBarShellStyles.modelMenu}
              data-agent-surface="model-picker"
              data-agent-proof="chat-model-picker-visible"
            >
              {featuredModels.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`${inputBarShellStyles.modelMenuItem} ${m.id === selectedModel ? inputBarShellStyles.modelMenuItemActive : ""}`}
                  data-agent-model-id={m.id}
                  data-agent-model-label={m.label}
                  onClick={() => {
                    onModelChange(m.id);
                    close();
                  }}
                >
                  {m.label}
                </button>
              ))}
              {hiddenModels.length > 0 ? (
                <button
                  type="button"
                  className={inputBarShellStyles.modelMenuShowMore}
                  onClick={() => setShowAllModels(true)}
                >
                  Show all models
                </button>
              ) : null}
            </div>
          );
        }
        if (shouldUseCondensedAuraMenu) {
          return (
            <div
              className={inputBarShellStyles.modelMenu}
              data-agent-surface="model-picker"
              data-agent-proof="chat-model-picker-visible"
            >
              {Array.from(groupedExpandedModels.entries()).map(
                ([provider, providerModels]) => (
                  <div key={provider} className={inputBarShellStyles.modelMenuGroup}>
                    <div className={inputBarShellStyles.modelMenuGroupLabel}>
                      {providerLabel(provider)}
                    </div>
                    {providerModels.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`${inputBarShellStyles.modelMenuItem} ${m.id === selectedModel ? inputBarShellStyles.modelMenuItemActive : ""}`}
                        data-agent-model-id={m.id}
                        data-agent-model-label={m.label}
                        onClick={() => {
                          onModelChange(m.id);
                          close();
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                ),
              )}
            </div>
          );
        }
        return (
          <div
            className={inputBarShellStyles.modelMenu}
            data-agent-surface="model-picker"
            data-agent-proof="chat-model-picker-visible"
          >
            {sortedModelsForMode.map((m) => {
              const isComingSoon = m.id.startsWith("dreamina-seedance");
              return (
              <button
                key={m.id}
                type="button"
                disabled={isComingSoon}
                className={`${inputBarShellStyles.modelMenuItem} ${m.id === selectedModel ? inputBarShellStyles.modelMenuItemActive : ""}`}
                data-agent-model-id={m.id}
                data-agent-model-label={m.label}
                style={isComingSoon ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                onClick={() => {
                  if (isComingSoon) return;
                  onModelChange(m.id);
                  close();
                }}
              >
                {m.label}{isComingSoon ? " (coming soon)" : ""}
              </button>
              );
            })}
          </div>
        );
      },
      [
        shouldUseCondensedAuraMenu,
        showAllModels,
        featuredModels,
        hiddenModels,
        selectedModel,
        onModelChange,
        groupedExpandedModels,
        sortedModelsForMode,
      ],
    );

    const isModelPickerInteractive = modelsForMode.length > 1;
    // Reset the condensed-menu state every time the picker reopens so a
    // user who clicked "Show all models" last time still lands on the
    // featured list first. `ModelPicker` itself keeps the caret focused
    // in the textarea via mousedown preventDefault, so we deliberately
    // do NOT blur the shell here — switching models should leave the
    // user's typing position intact.
    const handleModelPickerOpen = useCallback(() => {
      setShowAllModels(false);
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
        {modelsForMode.length > 0 ? (
          <div className={inputBarShellStyles.mobileModelBar}>
            <span className={inputBarShellStyles.mobileModelLabel}>Model</span>
            <ModelPicker
              selectedLabel={modelLabel(selectedModel ?? "", adapterType, defaultModel)}
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
          className={inputBarShellStyles.attachButton}
          onClick={() => fileInputRef.current?.click()}
          disabled={!canAddMore}
          aria-label="Attach file"
        >
          <Plus size={16} strokeWidth={1} />
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
        selectedLabel={modelLabel(selectedModel ?? "", adapterType, defaultModel)}
        isInteractive={isModelPickerInteractive}
        renderMenu={renderModelMenuItems}
        onOpen={handleModelPickerOpen}
        triggerProps={{ "data-agent-action": "open-model-picker" }}
        className={styles.inlineModelPicker}
      />
    ) : null;
    const showPickerInline = hasModelPicker && !isMultiLine;
    const showPickerInBottomRow = hasModelPicker && isMultiLine;
    const hasInputRowEnd = selectedCommands.length > 0 || showPickerInline;
    const inputRowEnd = hasInputRowEnd ? (
      <>
        {selectedCommands.length > 0 ? (
          <CommandChips
            commands={selectedCommands}
            onRemove={handleCommandRemove}
            variant="inline"
          />
        ) : null}
        {showPickerInline ? modelPickerNode : null}
      </>
    ) : null;
    const containerBottom = showPickerInBottomRow ? (
      <div className={styles.bottomChromeRow}>{modelPickerNode}</div>
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

    const infoBarEnd = (
      <>
        <button
          type="button"
          className={styles.avatarToggle}
          onClick={toggleAvatarWindow}
          aria-label="Toggle avatar"
          aria-pressed={avatarWindowOpen}
        >
          <Video size={10} />
          Avatar
        </button>
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
        {contextUsage != null && contextUsage.utilization > 0 ? (
          <ContextUsageIndicator
            utilization={contextUsage.utilization}
            estimatedTokens={contextUsage.estimatedTokens}
            breakdown={contextUsage.breakdown}
          />
        ) : null}
      </>
    );

    const modeBar = onNewChat ? (
      <div className={styles.modeBarRow}>
        <ModeSelector
          selectedMode={selectedMode}
          onChange={onModeChange}
          className={styles.modeSelectorFlex}
        />
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
      <ModeSelector selectedMode={selectedMode} onChange={onModeChange} />
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
      : selectedMode === "code"
        ? "/ for commands, @ for context"
        : "What do you want to create?";

    const isUploading = generationMode !== "image" && attachments.some((a) => a.uploading);

    return (
      <InputBarShell
        ref={shellRef}
        value={input}
        onValueChange={handleInputChange}
        onSubmit={handleSubmit}
        onStop={onStop}
        isStreaming={isStreaming}
        disabled={isUploading}
        isSendEnabled={isSendEnabled}
        isVisible={isVisible}
        isCentered={isCentered}
        isPulsing={isCentered}
        isDropZone={isDragOver}
        placeholder={placeholder}
        textareaProps={{ "data-agent-field": "chat-input" }}
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
