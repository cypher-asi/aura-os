import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUp, ChevronDown, FileText, Plus, X } from "lucide-react";
import { AgentEnvironment } from "../../../apps/agents/components/AgentEnvironment";
import { CommandChips } from "../../../apps/chat/components/ChatInputBar/CommandChips";
import { ContextUsageIndicator } from "../../../apps/chat/components/ChatInputBar/ContextUsageIndicator";
import { SlashCommandMenu } from "../../../apps/chat/components/ChatInputBar/SlashCommandMenu";
import { useFileAttachments } from "../../../apps/chat/components/ChatInputBar/useFileAttachments";
import type {
  AttachmentItem,
  ChatInputBarHandle,
  ChatInputBarProps,
} from "../../../apps/chat/components/ChatInputBar/ChatInputBar";
import { isGenerationCommand, type SlashCommand } from "../../../constants/commands";
import {
  availableModelsForAdapter,
  getModelsForMode,
  modelLabel,
  modelProviderGroup,
  sortModelsForMenu,
  type GenerationMode,
} from "../../../constants/models";
import {
  AGENT_MODE_DESCRIPTORS,
  type AgentMode,
} from "../../../constants/modes";
import { ModeSelector } from "../../../components/InputBarShell";
import { useIsStreaming } from "../../../hooks/stream/hooks";
import { useChatUI } from "../../../stores/chat-ui-store";
import styles from "./MobileChatInputBar.module.css";

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
      {attachments.map((attachment) => (
        <div key={attachment.id} className={styles.attachmentThumb}>
          {attachment.preview ? (
            <img src={attachment.preview} alt="" className={styles.attachmentThumbImg} />
          ) : (
            <FileText size={18} className={styles.attachmentFileIcon} />
          )}
          <span className={styles.attachmentName}>{attachment.name}</span>
          <button
            type="button"
            className={styles.attachmentRemove}
            onClick={() => onRemove(attachment.id)}
            aria-label="Remove attachment"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

function providerLabel(provider: string): string {
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
}

export const MobileChatInputBar = forwardRef<ChatInputBarHandle, ChatInputBarProps>(
  function MobileChatInputBar(
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
    const selectedMode = chatUI.selectedMode;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const slashStartRef = useRef<number | null>(null);
    const [modelSheetOpen, setModelSheetOpen] = useState(false);
    const [showAllModels, setShowAllModels] = useState(false);
    const [slashMenuOpen, setSlashMenuOpen] = useState(false);
    const [slashQuery, setSlashQuery] = useState("");
    const [isDragOver, setIsDragOver] = useState(false);
    const [isTextInputFocused, setIsTextInputFocused] = useState(false);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }));

    const { canAddMore, addFiles, handleRemove } = useFileAttachments(
      attachments,
      onAttachmentsChange,
      onRemoveAttachment,
      textareaRef,
    );

    const modeBehavior = AGENT_MODE_DESCRIPTORS[selectedMode].behavior;
    const generationMode: GenerationMode =
      modeBehavior.kind === "generate_image"
        ? "image"
        : modeBehavior.kind === "generate_3d"
          ? "3d"
          : "chat";
    const isLocalAgent = machineType === "local";
    const canSend = !isLocalAgent && !isStreaming && (
      input.trim().length > 0 || attachments.length > 0 || selectedCommands.length > 0
    );

    const modelsForMode =
      generationMode === "chat"
        ? availableModelsForAdapter(adapterType)
        : getModelsForMode(generationMode);
    const sortedModelsForMode = useMemo(
      () => sortModelsForMenu(modelsForMode),
      [modelsForMode],
    );
    const featuredModelIds = useMemo(
      () => new Set([
        "aura-gpt-5-5",
        "aura-gpt-5-4",
        "aura-gpt-5-4-mini",
        "aura-claude-opus-4-7",
        "aura-claude-sonnet-4-6",
      ]),
      [],
    );
    const shouldUseCondensedAuraMenu =
      generationMode === "chat" && (!adapterType || adapterType === "aura_harness");
    const featuredModels = useMemo(
      () => sortedModelsForMode.filter((model) => featuredModelIds.has(model.id)),
      [featuredModelIds, sortedModelsForMode],
    );
    const hiddenModels = useMemo(
      () => sortedModelsForMode.filter((model) => !featuredModelIds.has(model.id)),
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

    const onModelChange = useCallback(
      (model: string) => {
        chatUI.setSelectedModel(streamKey, model, adapterType, agentId);
      },
      [adapterType, agentId, chatUI, streamKey],
    );

    const onModeChange = useCallback(
      (mode: AgentMode) => {
        chatUI.setSelectedMode(streamKey, mode, adapterType, agentId);
        if (
          onCommandsChange &&
          selectedCommands.some((c) => isGenerationCommand(c.id))
        ) {
          onCommandsChange(selectedCommands.filter((c) => !isGenerationCommand(c.id)));
        }
      },
      [adapterType, agentId, chatUI, onCommandsChange, selectedCommands, streamKey],
    );

    const restoreViewportScroll = useCallback(() => {
      const reset = () => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      };
      reset();
      requestAnimationFrame(reset);
      window.setTimeout(reset, 80);
      window.setTimeout(reset, 240);
    }, []);

    const updateKeyboardInset = useCallback(() => {
      const visualViewport = window.visualViewport;
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const keyboardInset = Math.max(0, window.innerHeight - viewportHeight - viewportTop);
      document.documentElement.style.setProperty(
        "--aura-mobile-keyboard-inset",
        `${Math.round(keyboardInset)}px`,
      );
    }, []);

    const autoResizeTextarea = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 250)}px`;
    }, []);

    useEffect(() => {
      autoResizeTextarea();
    }, [autoResizeTextarea, input]);

    useEffect(() => {
      if (!modelSheetOpen) setShowAllModels(false);
    }, [modelSheetOpen]);

    useEffect(() => {
      const root = document.documentElement;
      if (isTextInputFocused) {
        root.dataset.mobileChatInputFocused = "true";
        updateKeyboardInset();
        restoreViewportScroll();
      } else {
        delete root.dataset.mobileChatInputFocused;
        root.style.removeProperty("--aura-mobile-keyboard-inset");
      }
      return () => {
        delete root.dataset.mobileChatInputFocused;
        root.style.removeProperty("--aura-mobile-keyboard-inset");
      };
    }, [isTextInputFocused, restoreViewportScroll, updateKeyboardInset]);

    useEffect(() => {
      if (!isTextInputFocused) return;
      const visualViewport = window.visualViewport;
      const handleViewportMove = () => {
        updateKeyboardInset();
        restoreViewportScroll();
      };
      window.addEventListener("scroll", handleViewportMove, { passive: true });
      window.addEventListener("resize", handleViewportMove);
      visualViewport?.addEventListener("scroll", handleViewportMove);
      visualViewport?.addEventListener("resize", handleViewportMove);
      return () => {
        window.removeEventListener("scroll", handleViewportMove);
        window.removeEventListener("resize", handleViewportMove);
        visualViewport?.removeEventListener("scroll", handleViewportMove);
        visualViewport?.removeEventListener("resize", handleViewportMove);
      };
    }, [isTextInputFocused, restoreViewportScroll, updateKeyboardInset]);

    const handleCommandSelect = useCallback(
      (command: SlashCommand) => {
        if (isGenerationCommand(command.id)) {
          const targetMode: AgentMode = command.id === "generate_image" ? "image" : "3d";
          chatUI.setSelectedMode(streamKey, targetMode, adapterType, agentId);
        } else {
          onCommandsChange?.([...selectedCommands, command]);
        }
        if (slashStartRef.current !== null) {
          const before = input.slice(0, slashStartRef.current);
          const afterSlash = input.slice(slashStartRef.current);
          const spaceIndex = afterSlash.indexOf(" ");
          const after = spaceIndex === -1 ? "" : afterSlash.slice(spaceIndex + 1);
          onInputChange(before + after);
        }
        setSlashMenuOpen(false);
        setSlashQuery("");
        slashStartRef.current = null;
        textareaRef.current?.focus();
      },
      [
        adapterType,
        agentId,
        chatUI,
        input,
        onCommandsChange,
        onInputChange,
        selectedCommands,
        streamKey,
      ],
    );

    const handleCommandRemove = useCallback(
      (id: string) => {
        onCommandsChange?.(selectedCommands.filter((command) => command.id !== id));
      },
      [onCommandsChange, selectedCommands],
    );

    const handleInputChange = useCallback(
      (value: string) => {
        onInputChange(value);
        const el = textareaRef.current;
        if (!el) return;
        const textBefore = value.slice(0, el.selectionStart);
        const slashMatch = textBefore.match(/(^|\s)\/(\S*)$/);
        if (slashMatch) {
          slashStartRef.current = textBefore.lastIndexOf("/");
          setSlashQuery(slashMatch[2]);
          setSlashMenuOpen(true);
          return;
        }
        if (slashMenuOpen) {
          setSlashMenuOpen(false);
          setSlashQuery("");
          slashStartRef.current = null;
        }
      },
      [onInputChange, slashMenuOpen],
    );

    const submitMessage = useCallback(() => {
      if (!canSend) return;
      // Mode lives in the per-stream store; the panel state reads it
      // when constructing the resolved send.
      onSend(input, undefined, undefined);
    }, [canSend, input, onSend]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (slashMenuOpen && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitMessage();
      }
    };

    const handlePaste = useCallback(
      (event: React.ClipboardEvent) => {
        const items = event.clipboardData?.items;
        if (!items) return;
        const imageFiles: File[] = [];
        let hasNonImageClipboardItem = false;
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) imageFiles.push(file);
            continue;
          }
          hasNonImageClipboardItem = true;
        }
        if (imageFiles.length > 0 && !hasNonImageClipboardItem) {
          event.preventDefault();
          const dt = new DataTransfer();
          imageFiles.forEach((file) => dt.items.add(file));
          addFiles(dt.files);
        }
      },
      [addFiles],
    );

    const handleDragOver = useCallback((event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);
    }, []);

    const handleDrop = useCallback(
      (event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragOver(false);
        addFiles(event.dataTransfer.files);
      },
      [addFiles],
    );

    const excludeIds = new Set(selectedCommands.map((command) => command.id));
    const selectedModelLabel = modelLabel(selectedModel ?? "", adapterType, defaultModel);
    const visibleModels = shouldUseCondensedAuraMenu && !showAllModels ? featuredModels : sortedModelsForMode;

    const modelList = shouldUseCondensedAuraMenu && showAllModels
      ? Array.from(groupedExpandedModels.entries()).map(([provider, providerModels]) => (
        <div key={provider} className={styles.modelGroup}>
          <div className={styles.modelGroupLabel}>{providerLabel(provider)}</div>
          {providerModels.map((model) => (
            <button
              key={model.id}
              type="button"
              className={`${styles.modelItem} ${model.id === selectedModel ? styles.modelItemActive : ""}`}
              data-agent-model-id={model.id}
              onClick={() => {
                onModelChange(model.id);
                setModelSheetOpen(false);
              }}
            >
              <span>{model.label}</span>
              <span className={styles.modelProvider}>{providerLabel(modelProviderGroup(model))}</span>
            </button>
          ))}
        </div>
      ))
      : visibleModels.map((model) => (
        <button
          key={model.id}
          type="button"
          className={`${styles.modelItem} ${model.id === selectedModel ? styles.modelItemActive : ""}`}
          data-agent-model-id={model.id}
          onClick={() => {
            onModelChange(model.id);
            setModelSheetOpen(false);
          }}
        >
          <span>{model.label}</span>
          <span className={styles.modelProvider}>{providerLabel(modelProviderGroup(model))}</span>
        </button>
      ));

    const shouldCenterComposer = isCentered && !isTextInputFocused && !modelSheetOpen;

    return (
      <>
        {modelSheetOpen ? (
          <>
            <button
              type="button"
              className={styles.sheetBackdrop}
              aria-label="Close model picker"
              onClick={() => setModelSheetOpen(false)}
            />
            <div className={styles.modelSheet} role="dialog" aria-modal="true" aria-label="Select model">
              <div className={styles.sheetGrabber} aria-hidden="true" />
              <div className={styles.sheetHeader}>
                <div>
                  <div className={styles.sheetTitle}>Model</div>
                  <div className={styles.sheetSubtitle}>{generationMode === "chat" ? "Choose how this agent replies." : "Generation mode"}</div>
                </div>
                <button type="button" className={styles.sheetDone} onClick={() => setModelSheetOpen(false)}>Done</button>
              </div>
              <div className={styles.modelList}>
                {modelList}
                {shouldUseCondensedAuraMenu && !showAllModels && hiddenModels.length > 0 ? (
                  <button type="button" className={styles.showAllModels} onClick={() => setShowAllModels(true)}>
                    Show all models
                  </button>
                ) : null}
              </div>
            </div>
          </>
        ) : null}

        <div
          className={`${styles.root}${isVisible ? "" : ` ${styles.rootHidden}`}${shouldCenterComposer ? ` ${styles.rootCentered}` : ""}${isTextInputFocused ? ` ${styles.rootInputFocused}` : ""}`}
          aria-hidden={isVisible ? undefined : true}
          data-visible={isVisible ? "true" : "false"}
          data-centered={shouldCenterComposer ? "true" : "false"}
          data-agent-surface="mobile-chat-input-bar"
        >
        <div
          className={`${styles.composer}${isDragOver ? ` ${styles.composerDragOver}` : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {slashMenuOpen ? (
            <div className={styles.slashMenuWrap}>
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
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            multiple
            className={styles.fileInputHidden}
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <ModeSelector
            selectedMode={selectedMode}
            onChange={onModeChange}
            className={styles.modeSelector}
          />
          <AttachmentPreviews attachments={attachments} onRemove={handleRemove} />
          <CommandChips commands={selectedCommands} onRemove={handleCommandRemove} />
          <div className={styles.inputRow}>
            <button
              type="button"
              className={styles.attachButton}
              onClick={() => fileInputRef.current?.click()}
              disabled={!canAddMore}
              aria-label="Attach file"
            >
              <Plus size={18} strokeWidth={1.8} />
            </button>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              value={input}
              onChange={(event) => handleInputChange(event.target.value)}
              onFocus={() => {
                setIsTextInputFocused(true);
                updateKeyboardInset();
                restoreViewportScroll();
              }}
              onBlur={() => setIsTextInputFocused(false)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={isLocalAgent ? "Remote agent required" : "Message agent"}
              rows={1}
              data-agent-field="chat-input"
            />
            {isStreaming ? (
              <button
                type="button"
                className={`${styles.sendButton} ${styles.stopButton}`}
                onClick={onStop}
                aria-label={isExternallyBusy && !isChatStreaming ? "Stop automation" : "Stop"}
                title={isExternallyBusy && !isChatStreaming ? externalBusyMessage ?? "Stop the running automation" : undefined}
              >
                <span className={styles.stopIcon} />
              </button>
            ) : (
              <button
                type="button"
                className={styles.sendButton}
                onClick={submitMessage}
                disabled={!canSend}
                aria-label="Send"
              >
                <ArrowUp size={17} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div className={styles.metaRow}>
            <span className={styles.environmentWrap}>
              {machineType ? (
                <AgentEnvironment machineType={machineType} agentId={templateAgentId ?? agentId} />
              ) : null}
            </span>
            <span className={styles.metaSpacer} />
            {contextUsage != null && contextUsage.utilization > 0 ? (
              <ContextUsageIndicator
                utilization={contextUsage.utilization}
                estimatedTokens={contextUsage.estimatedTokens}
                onNewSession={onNewSession}
              />
            ) : null}
            {modelsForMode.length > 0 ? (
              <button
                type="button"
                className={styles.modelButton}
                data-agent-action="open-model-picker"
                aria-haspopup={modelsForMode.length > 1 ? "dialog" : undefined}
                aria-expanded={modelsForMode.length > 1 ? modelSheetOpen : undefined}
                onClick={() => {
                  if (modelsForMode.length <= 1) return;
                  textareaRef.current?.blur();
                  setModelSheetOpen(true);
                }}
              >
                <span>{selectedModelLabel}</span>
                {modelsForMode.length > 1 ? <ChevronDown size={13} /> : null}
              </button>
            ) : null}
          </div>
        </div>
        </div>
      </>
    );
  },
);
