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
  RotateCcw,
} from "lucide-react";
import { track } from "../../../../lib/analytics";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import type { ContextUsageEntry } from "../../../../stores/context-usage-store";
import { useIsStreaming } from "../../../../hooks/stream/hooks";
import { useFileAttachments } from "./useFileAttachments";
import type { GenerationMode } from "../../../../constants/models";
import {
  availableModelsForAdapter,
  modelLabel,
  getModelsForMode,
  getDefaultModelForMode,
  modelProviderGroup,
  sortModelsForMenu,
} from "../../../../constants/models";
import { isGenerationCommand } from "../../../../constants/commands";
import { AgentEnvironment } from "../../../agents/components/AgentEnvironment";
import { OrbitStatusIndicator } from "../../../../components/OrbitStatusIndicator";
import {
  InputBarShell,
  inputBarShellStyles,
  ModelPicker,
  type InputBarShellHandle,
} from "../../../../components/InputBarShell";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { CommandChips } from "./CommandChips";
import { useChatUI } from "../../../../stores/chat-ui-store";
import type { SlashCommand } from "../../../../constants/commands";
import type { Project } from "../../../../shared/types";
import styles from "./ChatInputBar.module.css";

export interface ChatInputBarHandle {
  focus: () => void;
}

export interface AttachmentItem {
  id: string;
  file: File;
  data: string;
  mediaType: string;
  name: string;
  attachmentType: "image" | "text";
  preview?: string;
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
  isVisible?: boolean;
  isCentered?: boolean;
  /**
   * When true, hides the "/ for commands" hint in the info bar to save
   * horizontal space. Used in floating desktop agent windows where the
   * chat surface can be very narrow. Image / 3D mode labels are still
   * shown since they convey active state, not just a hint.
   */
  compact?: boolean;
  contextUsage?: ContextUsageEntry;
  onNewSession?: () => void;
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
        <div key={a.id} className={styles.attachmentThumb}>
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
      isVisible = true,
      isCentered = false,
      compact = false,
      contextUsage,
      onNewSession,
    },
    ref,
  ) {
    const isChatStreaming = useIsStreaming(streamKey);
    const isStreaming = isChatStreaming || isExternallyBusy;
    const chatUI = useChatUI(streamKey);
    const selectedModel = chatUI.selectedModel;
    const onModelChange = useCallback(
      (model: string) => {
        chatUI.setSelectedModel(streamKey, model, adapterType, agentId);
      },
      [chatUI.setSelectedModel, streamKey, adapterType, agentId],
    );
    const [isDragOver, setIsDragOver] = useState(false);
    const [showAllModels, setShowAllModels] = useState(false);
    const [projectMenuOpen, setProjectMenuOpen] = useState(false);
    const [slashMenuOpen, setSlashMenuOpen] = useState(false);
    const [slashQuery, setSlashQuery] = useState("");
    const slashStartRef = useRef<number | null>(null);
    const projectMenuRef = useRef<HTMLDivElement>(null);
    const shellRef = useRef<InputBarShellHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => ({
      focus: () => shellRef.current?.focus(),
    }));

    const textareaRefShim = useMemo(
      () => ({
        get current() {
          return shellRef.current?.getTextarea() ?? null;
        },
      }),
      [],
    );

    const { canAddMore, addFiles, handleRemove } = useFileAttachments(
      attachments,
      onAttachmentsChange,
      onRemoveAttachment,
      textareaRefShim as React.RefObject<HTMLTextAreaElement | null>,
    );

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    }, []);
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
        addFiles(e.dataTransfer.files);
      },
      [addFiles],
    );

    const handlePaste = useCallback(
      (e: React.ClipboardEvent) => {
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
      [addFiles],
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

    const generationMode: GenerationMode = selectedCommands.some(
      (c) => c.id === "generate_image",
    )
      ? "image"
      : selectedCommands.some((c) => c.id === "generate_3d")
        ? "3d"
        : "chat";
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
        let next: SlashCommand[];
        if (isGenerationCommand(cmd.id)) {
          next = [
            ...selectedCommands.filter((c) => !isGenerationCommand(c.id)),
            cmd,
          ];
          const mode = cmd.id === "generate_image" ? "image" : "3d";
          // Only switch models when the target mode actually has selectable models.
          // 3D generation has no user-selectable model, so we leave the current
          // selection untouched to avoid clobbering the user's chat model.
          if (getModelsForMode(mode).length > 0) {
            const defaultForMode = getDefaultModelForMode(mode);
            onModelChange(defaultForMode.id);
          }
        } else {
          next = [...selectedCommands, cmd];
        }
        onCommandsChange?.(next);
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
      [selectedCommands, onCommandsChange, input, onInputChange, onModelChange],
    );

    const handleCommandRemove = useCallback(
      (id: string) => {
        onCommandsChange?.(selectedCommands.filter((c) => c.id !== id));
        if (isGenerationCommand(id)) {
          onModelChange(getDefaultModelForMode("chat").id);
        }
      },
      [selectedCommands, onCommandsChange, onModelChange],
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
      },
      [onInputChange, slashMenuOpen],
    );

    const handleTextareaKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (
          slashMenuOpen &&
          ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)
        ) {
          // The slash menu owns these keys while open; preventDefault tells
          // the shell not to treat Enter as submit.
          e.preventDefault();
        }
      },
      [slashMenuOpen],
    );

    const handleSubmit = useCallback(() => {
      track("chat_message_sent", { model: selectedModel });
      onSend(
        input,
        undefined,
        undefined,
        generationMode !== "chat" ? generationMode : undefined,
      );
    }, [input, generationMode, onSend, selectedModel]);

    const providerLabel = (provider: string): string => {
      switch (provider) {
        case "aura":
          return "Aura";
        case "image":
          return "Image";
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
            {sortedModelsForMode.map((m) => (
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
    const handleModelPickerOpen = useCallback(() => {
      shellRef.current?.blur();
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
        <CommandChips
          commands={selectedCommands}
          onRemove={handleCommandRemove}
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

    const inputRowStart = (
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

    const infoBarStart = (
      <>
        {machineType ? (
          <>
            <span className={styles.environmentWrap}>
              <AgentEnvironment
                machineType={machineType}
                agentId={templateAgentId ?? agentId}
              />
            </span>
            <span className={styles.infoDivider} aria-hidden="true">
              ·
            </span>
          </>
        ) : null}
        <span className={styles.orbitWrap}>
          <OrbitStatusIndicator project={selectedProject} />
        </span>
        {compact && generationMode === "chat" ? null : (
          <>
            <span className={styles.infoDivider} aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              className={styles.commandsTrigger}
              onClick={() => {
                if (generationMode !== "chat") return;
                onInputChange(
                  input.endsWith(" ") || input.length === 0
                    ? input + "/"
                    : input + " /",
                );
                slashStartRef.current = (
                  input.endsWith(" ") || input.length === 0
                    ? input
                    : input + " "
                ).length;
                setSlashQuery("");
                setSlashMenuOpen(true);
                shellRef.current?.focus();
              }}
            >
              {generationMode === "image"
                ? "/image mode"
                : generationMode === "3d"
                  ? "/3d mode"
                  : "/ for commands"}
            </button>
          </>
        )}
      </>
    );

    const infoBarEnd = (
      <>
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
            onNewSession={onNewSession}
          />
        ) : onNewSession ? (
          <button
            type="button"
            className={styles.newSessionButton}
            onClick={onNewSession}
            title="Start a new session and reset context."
            aria-label="Start new session"
          >
            <RotateCcw size={10} />
          </button>
        ) : null}
        {modelsForMode.length > 0 && (
          <ModelPicker
            selectedLabel={modelLabel(selectedModel ?? "", adapterType, defaultModel)}
            isInteractive={isModelPickerInteractive}
            renderMenu={renderModelMenuItems}
            onOpen={handleModelPickerOpen}
            triggerProps={{ "data-agent-action": "open-model-picker" }}
          />
        )}
      </>
    );

    return (
      <InputBarShell
        ref={shellRef}
        value={input}
        onValueChange={handleInputChange}
        onSubmit={handleSubmit}
        onStop={onStop}
        isStreaming={isStreaming}
        isSendEnabled={
          input.trim().length > 0 ||
          attachments.length > 0 ||
          selectedCommands.length > 0
        }
        isVisible={isVisible}
        isCentered={isCentered}
        isPulsing={isCentered}
        isDropZone={isDragOver}
        placeholder="What do you want to create?"
        textareaProps={{ "data-agent-field": "chat-input" }}
        onTextareaKeyDown={handleTextareaKeyDown}
        onTextareaPaste={handlePaste}
        onContainerDragOver={handleDragOver}
        onContainerDragLeave={handleDragLeave}
        onContainerDrop={handleDrop}
        containerTop={containerTop}
        inputRowStart={inputRowStart}
        infoBarStart={infoBarStart}
        infoBarEnd={infoBarEnd}
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
