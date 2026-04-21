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
  ArrowUp,
  Plus,
  X,
  FileText,
  ChevronDown,
  FolderOpen,
  RotateCcw,
} from "lucide-react";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import type { ContextUsageEntry } from "../../stores/context-usage-store";
import { useIsStreaming } from "../../hooks/stream/hooks";
import { useFileAttachments } from "./useFileAttachments";
import type { GenerationMode } from "../../constants/models";
import {
  availableModelsForAdapter,
  modelLabel,
  getModelsForMode,
  getDefaultModelForMode,
  modelProviderGroup,
  sortModelsForMenu,
} from "../../constants/models";
import { isGenerationCommand } from "../../constants/commands";
import { AgentEnvironment } from "../AgentEnvironment";
import { OrbitStatusIndicator } from "../OrbitStatusIndicator";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { CommandChips } from "./CommandChips";
import { useChatUI } from "../../stores/chat-ui-store";
import type { SlashCommand } from "../../constants/commands";
import type { Project } from "../../types";
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

interface Props {
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

export const ChatInputBar = memo(
  forwardRef<ChatInputBarHandle, Props>(function ChatInputBar(
    {
      input,
      onInputChange,
      onSend,
      onStop,
      streamKey,
      isExternallyBusy = false,
      externalBusyMessage,
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
    const [modelMenuOpen, setModelMenuOpen] = useState(false);
    const [showAllModels, setShowAllModels] = useState(false);
    const [projectMenuOpen, setProjectMenuOpen] = useState(false);
    const [slashMenuOpen, setSlashMenuOpen] = useState(false);
    const [slashQuery, setSlashQuery] = useState("");
    const slashStartRef = useRef<number | null>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);
    const projectMenuRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }));

    const { canAddMore, addFiles, handleRemove } = useFileAttachments(
      attachments,
      onAttachmentsChange,
      onRemoveAttachment,
      textareaRef,
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
        let hasNonImageClipboardItem = false;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) imageFiles.push(file);
            continue;
          }
          hasNonImageClipboardItem = true;
        }
        if (imageFiles.length > 0 && !hasNonImageClipboardItem) {
          e.preventDefault();
          const dt = new DataTransfer();
          imageFiles.forEach((f) => dt.items.add(f));
          addFiles(dt.files);
        }
      },
      [addFiles],
    );

    const autoResizeTextarea = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      // Cap the inline height to match the CSS max-height so the textarea's
      // own scrollbar engages for long messages (and native caret-follow on
      // Arrow keys keeps working).
      const cap = Math.min(window.innerHeight * 0.7, 800);
      el.style.height = Math.min(el.scrollHeight, cap) + "px";
    }, []);

    useEffect(() => {
      autoResizeTextarea();
    }, [input, autoResizeTextarea]);

    useEffect(() => {
      const onResize = () => autoResizeTextarea();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, [autoResizeTextarea]);

    useEffect(() => {
      if (!modelMenuOpen) return;
      const onClickOutside = (e: MouseEvent) => {
        if (
          modelMenuRef.current &&
          !modelMenuRef.current.contains(e.target as Node)
        ) {
          setModelMenuOpen(false);
        }
      };
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }, [modelMenuOpen]);

    useEffect(() => {
      if (!modelMenuOpen) {
        setShowAllModels(false);
      }
    }, [modelMenuOpen]);

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
    // In chat mode, let the adapter (codex/gemini/opencode/cursor/default) drive
    // the available model list. In image/3d mode, use the mode-filtered model
    // list which is the same across adapters (adapter-specific models are
    // chat-only today).
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
        textareaRef.current?.focus();
      },
      [selectedCommands, onCommandsChange, input, onInputChange, onModelChange],
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
        const el = textareaRef.current;
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

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        slashMenuOpen &&
        ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)
      ) {
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSend(
          input,
          undefined,
          undefined,
          generationMode !== "chat" ? generationMode : undefined,
        );
      }
    };

    const providerLabel = (provider: string): string => {
      switch (provider) {
        case "openai":
          return "OpenAI";
        case "anthropic":
          return "Anthropic";
        case "open_source":
          return "Open source";
        default:
          return "Other";
      }
    };

    return (
      <div
        className={`${styles.inputWrapper}${isVisible ? "" : ` ${styles.inputWrapperHidden}`}${isCentered ? ` ${styles.inputWrapperCentered}` : ""}`}
        aria-hidden={isVisible ? undefined : true}
        data-visible={isVisible ? "true" : "false"}
        data-centered={isCentered ? "true" : "false"}
      >
        <div
          className={`${styles.inputContainer} ${isDragOver ? styles.dropZoneActive : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
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
            className={styles.fileInputHidden}
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
          <div className={styles.inputRow}>
            <button
              type="button"
              className={styles.attachButton}
              onClick={() => fileInputRef.current?.click()}
              disabled={!canAddMore}
              aria-label="Attach file"
            >
              <Plus size={16} strokeWidth={1} />
            </button>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="What do you want to create?"
              rows={1}
            />
            {isStreaming ? (
              <button
                type="button"
                className={`${styles.sendButton} ${styles.stopButton}`}
                onClick={onStop}
                aria-label={
                  isExternallyBusy && !isChatStreaming
                    ? "Stop automation"
                    : "Stop"
                }
                title={
                  isExternallyBusy && !isChatStreaming
                    ? externalBusyMessage ?? "Stop the running automation"
                    : undefined
                }
              >
                <span className={styles.stopIcon} />
              </button>
            ) : (
              <button
                type="button"
                className={styles.sendButton}
                onClick={() =>
                  onSend(
                    input,
                    undefined,
                    undefined,
                    generationMode !== "chat" ? generationMode : undefined,
                  )
                }
                disabled={
                  !input.trim() &&
                  attachments.length === 0 &&
                  selectedCommands.length === 0
                }
                aria-label="Send"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
        <div className={styles.inputInfoBar}>
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
                input.endsWith(" ") || input.length === 0 ? input : input + " "
              ).length;
              setSlashQuery("");
              setSlashMenuOpen(true);
              textareaRef.current?.focus();
            }}
          >
            {generationMode === "image"
              ? "/image mode"
              : generationMode === "3d"
                ? "/3d mode"
                : "/ for commands"}
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
            <div className={styles.modelMenuWrap} ref={modelMenuRef}>
              <button
                type="button"
                className={styles.modelButton}
                onClick={
                  modelsForMode.length > 1
                    ? () => setModelMenuOpen((v) => !v)
                    : undefined
                }
                style={
                  modelsForMode.length > 1 ? undefined : { cursor: "default" }
                }
              >
                {modelLabel(selectedModel ?? "", adapterType, defaultModel)}
                {modelsForMode.length > 1 && <ChevronDown size={10} />}
              </button>
              {modelMenuOpen && modelsForMode.length > 1 && (
                <div className={styles.modelMenu}>
                  {shouldUseCondensedAuraMenu && !showAllModels ? (
                    <>
                      {featuredModels.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={`${styles.modelMenuItem} ${m.id === selectedModel ? styles.modelMenuItemActive : ""}`}
                          onClick={() => {
                            onModelChange(m.id);
                            setModelMenuOpen(false);
                          }}
                        >
                          {m.label}
                        </button>
                      ))}
                      {hiddenModels.length > 0 ? (
                        <button
                          type="button"
                          className={styles.modelMenuShowMore}
                          onClick={() => setShowAllModels(true)}
                        >
                          Show all models
                        </button>
                      ) : null}
                    </>
                  ) : shouldUseCondensedAuraMenu ? (
                    <>
                      {Array.from(groupedExpandedModels.entries()).map(
                        ([provider, providerModels]) => (
                          <div key={provider} className={styles.modelMenuGroup}>
                            <div className={styles.modelMenuGroupLabel}>
                              {providerLabel(provider)}
                            </div>
                            {providerModels.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                className={`${styles.modelMenuItem} ${m.id === selectedModel ? styles.modelMenuItemActive : ""}`}
                                onClick={() => {
                                  onModelChange(m.id);
                                  setModelMenuOpen(false);
                                }}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                        ),
                      )}
                    </>
                  ) : (
                    sortedModelsForMode.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`${styles.modelMenuItem} ${m.id === selectedModel ? styles.modelMenuItemActive : ""}`}
                        onClick={() => {
                          onModelChange(m.id);
                          setModelMenuOpen(false);
                        }}
                      >
                        {m.label}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }),
);
