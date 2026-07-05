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
import { CommandChips } from "../../../features/chat-ui/ChatInputBar/CommandChips";
import { ContextUsageIndicator } from "../../../features/chat-ui/ChatInputBar/ContextUsageIndicator";
import { SlashCommandMenu } from "../../../features/chat-ui/ChatInputBar/SlashCommandMenu";
import { useFileAttachments } from "../../../features/chat-ui/ChatInputBar/useFileAttachments";
import type {
  AttachmentItem,
  ChatInputBarHandle,
  ChatInputBarProps,
} from "../../../features/chat-ui/ChatInputBar/ChatInputBar";
import { isGenerationCommand, type SlashCommand } from "../../../constants/commands";
import {
  availableModelsForAdapter,
  formatCreditMultiplier,
  getModelsForMode,
  groupChatModelsByVendor,
  IMAGE_QUALITY_OPTIONS,
  modelLabelWithEffort,
  modelSupportsQuality,
  sortModelsForMenu,
  type GenerationMode,
  type ImageQuality,
  type ModelOption,
  type ModelVendor,
} from "../../../constants/models";
import {
  AGENT_MODE_DESCRIPTORS,
  type AgentMode,
} from "../../../constants/modes";
import { ModeSelector, ModelMenuGroup } from "../../../components/InputBarShell";
import { useIsStreaming } from "../../../hooks/stream/hooks";
import { useChatUI } from "../../../stores/chat-ui-store";
import { track } from "../../../lib/analytics";
import styles from "./MobileChatInputBar.module.css";

const CHAT_COMPOSER_MODE_LABELS: Partial<Record<AgentMode, string>> = {
  code: "Chat",
};

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
      workspacePath,
      isVisible = true,
      isCentered = false,
      contextUsage,
      onNewChat,
      sendDisabled = false,
      composerTone = "build",
    },
    ref,
  ) {
    const isChatStreaming = useIsStreaming(streamKey);
    const isStreaming = isChatStreaming || isExternallyBusy;
    const chatUI = useChatUI(streamKey);
    const selectedModel = chatUI.selectedModel;
    const selectedEffort = chatUI.selectedEffort;
    const selectedMode = chatUI.selectedMode;
    const imageQuality = chatUI.imageQuality;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const slashStartRef = useRef<number | null>(null);
    const [modelSheetOpen, setModelSheetOpen] = useState(false);
    const [qualitySheetOpen, setQualitySheetOpen] = useState(false);
    // Collapsed vendor sections in the chat model sheet. Empty = all
    // expanded (the default whenever the sheet opens).
    const [collapsedVendors, setCollapsedVendors] = useState<Set<ModelVendor>>(
      () => new Set(),
    );
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
          : modeBehavior.kind === "generate_video"
            ? "video"
            : "chat";
    const isLocalAgent = sendDisabled;
    const isThreeDMode = generationMode === "3d";
    const pinnedSourceImage = chatUI.pinnedSourceImage;
    const has3DSource = isThreeDMode && pinnedSourceImage != null;
    const setPinnedSourceImage = chatUI.setPinnedSourceImage;
    const handleClearPinnedSource = useCallback(() => {
      setPinnedSourceImage(streamKey, null);
    }, [setPinnedSourceImage, streamKey]);
    // 3D mode is a two-step pipeline:
    //  - no thumb (image step): typed text seeds an AURA-styled image
    //    generation, so Send requires text;
    //  - thumb pinned (model step): Send is enabled regardless of
    //    text (refinement is optional).
    const canSend =
      !isLocalAgent &&
      !isStreaming &&
      (isThreeDMode
        ? has3DSource ||
          input.trim().length > 0 ||
          selectedCommands.length > 0
        : input.trim().length > 0 ||
          attachments.length > 0 ||
          selectedCommands.length > 0);

    const modelsForMode =
      generationMode === "chat"
        ? availableModelsForAdapter(adapterType)
        : getModelsForMode(generationMode);
    const sortedModelsForMode = useMemo(
      () => sortModelsForMenu(modelsForMode),
      [modelsForMode],
    );
    const shouldUseCondensedAuraMenu =
      generationMode === "chat" && (!adapterType || adapterType === "aura_harness");
    // Ordered, non-empty vendor sections for the collapsible chat sheet.
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

    const onModelChange = useCallback(
      (model: string) => {
        chatUI.setSelectedModel(streamKey, model, adapterType, agentId);
      },
      [adapterType, agentId, chatUI, streamKey],
    );
    const onImageQualityChange = useCallback(
      (quality: ImageQuality) => {
        chatUI.setImageQuality(streamKey, quality, agentId);
      },
      [agentId, chatUI, streamKey],
    );
    const showQualityPicker =
      generationMode === "image" && modelSupportsQuality(selectedModel);
    const selectedQualityLabel =
      IMAGE_QUALITY_OPTIONS.find((q) => q.id === imageQuality)?.label ??
      imageQuality;

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
          const targetMode: AgentMode =
            command.id === "generate_image" ? "image" :
            command.id === "generate_video" ? "video" :
            "3d";
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
      // Mirror ChatInputBar.handleSubmit: emit before onSend so the engaged
      // signal fires regardless of any downstream send/runtime failure.
      // Mobile previously omitted this, so mobile chat sends were untracked.
      track("chat_message_sent", { model: selectedModel, mode: selectedMode });
      // Mode lives in the per-stream store; the panel state reads it
      // when constructing the resolved send.
      onSend(input, undefined, undefined);
    }, [canSend, input, onSend, selectedModel, selectedMode]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (slashMenuOpen && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitMessage();
      }
    };

    // 3D mode disables manual file intake (paste / drop / attach
    // button) for parity with the desktop input bar — the only
    // valid 3D source is the per-stream pinned image (set by the
    // 3D image step or seeded from chat history). Other modes are
    // unaffected.
    const handlePaste = useCallback(
      (event: React.ClipboardEvent) => {
        if (isThreeDMode) return;
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
      [addFiles, isThreeDMode],
    );

    const handleDragOver = useCallback(
      (event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (isThreeDMode) return;
        setIsDragOver(true);
      },
      [isThreeDMode],
    );

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
        if (isThreeDMode) return;
        addFiles(event.dataTransfer.files);
      },
      [addFiles, isThreeDMode],
    );

    const excludeIds = new Set(selectedCommands.map((command) => command.id));
    const selectedModelLabel = modelLabelWithEffort(
      selectedModel ?? "",
      selectedEffort,
      adapterType,
      defaultModel,
    );

    const renderModelButton = (model: ModelOption) => {
      const multiplierText = formatCreditMultiplier(model.creditMultiplier);
      return (
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
          <span className={styles.modelMeta}>
            {multiplierText ? (
              <span className={styles.modelMultiplier}>{multiplierText}</span>
            ) : null}
          </span>
        </button>
      );
    };

    const modelList = shouldUseCondensedAuraMenu
      ? vendorGroups.map((group) => (
        <ModelMenuGroup
          key={group.vendor}
          label={group.label}
          collapsed={collapsedVendors.has(group.vendor)}
          onToggle={() => toggleVendor(group.vendor)}
          className={styles.modelGroup}
          headerClassName={styles.modelGroupHeader}
          labelClassName={styles.modelGroupLabel}
        >
          {group.models.map(renderModelButton)}
        </ModelMenuGroup>
      ))
      : sortedModelsForMode.map(renderModelButton);

    const shouldCenterComposer =
      isCentered && !isTextInputFocused && !modelSheetOpen && !qualitySheetOpen;

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
              </div>
            </div>
          </>
        ) : null}

        {qualitySheetOpen ? (
          <>
            <button
              type="button"
              className={styles.sheetBackdrop}
              aria-label="Close quality picker"
              onClick={() => setQualitySheetOpen(false)}
            />
            <div
              className={styles.modelSheet}
              role="dialog"
              aria-modal="true"
              aria-label="Select image quality"
              data-agent-surface="image-quality-picker"
            >
              <div className={styles.sheetGrabber} aria-hidden="true" />
              <div className={styles.sheetHeader}>
                <div>
                  <div className={styles.sheetTitle}>Quality</div>
                  <div className={styles.sheetSubtitle}>
                    Lower quality renders faster.
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.sheetDone}
                  onClick={() => setQualitySheetOpen(false)}
                >
                  Done
                </button>
              </div>
              <div className={styles.modelList}>
                {IMAGE_QUALITY_OPTIONS.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className={`${styles.modelItem} ${q.id === imageQuality ? styles.modelItemActive : ""}`}
                    onClick={() => {
                      onImageQualityChange(q.id);
                      setQualitySheetOpen(false);
                    }}
                  >
                    <span>{q.label}</span>
                  </button>
                ))}
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
          {onNewChat ? (
            <div className={styles.modeBarRow}>
              <ModeSelector
                selectedMode={selectedMode}
                onChange={onModeChange}
                labels={
                  composerTone === "chat"
                    ? CHAT_COMPOSER_MODE_LABELS
                    : undefined
                }
                className={`${styles.modeSelector} ${styles.modeSelectorFlex}`}
              />
              <button
                type="button"
                className={styles.modeNewChatButton}
                onClick={onNewChat}
                title="Start a new chat"
                aria-label="Start new chat"
                data-agent-action="start-new-chat"
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <ModeSelector
              selectedMode={selectedMode}
              onChange={onModeChange}
              labels={
                composerTone === "chat" ? CHAT_COMPOSER_MODE_LABELS : undefined
              }
              className={styles.modeSelector}
            />
          )}
          <AttachmentPreviews attachments={attachments} onRemove={handleRemove} />
          <CommandChips commands={selectedCommands} onRemove={handleCommandRemove} />
          <div className={styles.inputRow}>
            {isThreeDMode ? (
              has3DSource && pinnedSourceImage ? (
                <div
                  className={`${styles.attachButton} ${styles.sourceImageInline}`}
                  data-agent-surface="mobile-chat-input-3d-source-thumb"
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
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <span aria-hidden="true" />
              )
            ) : (
              <button
                type="button"
                className={styles.attachButton}
                onClick={() => fileInputRef.current?.click()}
                disabled={!canAddMore || sendDisabled}
                aria-label="Attach file"
              >
                <Plus size={18} strokeWidth={1.8} />
              </button>
            )}
            <textarea
              ref={textareaRef}
              className={`${styles.textarea}${isLocalAgent ? ` ${styles.textareaAwaitingRemote}` : ""}`}
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
              disabled={sendDisabled}
              placeholder={
                isLocalAgent
                  ? "Remote agent required. Please switch agent"
                  : isThreeDMode
                    ? has3DSource
                      ? "Refine your 3D model (optional)"
                      : "Describe an image to generate\u2026"
                    : composerTone === "chat"
                      ? "Ask Aura anything..."
                      : "Message agent"
              }
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
              <AgentEnvironment
                machineType={machineType}
                agentId={templateAgentId ?? agentId}
                workspacePath={workspacePath}
              />
            </span>
            <span className={styles.metaSpacer} />
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
                  // Expand every vendor section on each open so a user
                  // who collapsed sections last time sees the full list.
                  setCollapsedVendors(new Set());
                  setModelSheetOpen(true);
                }}
              >
                <span>{selectedModelLabel}</span>
                {modelsForMode.length > 1 ? <ChevronDown size={13} /> : null}
              </button>
            ) : null}
            {showQualityPicker ? (
              <button
                type="button"
                className={styles.modelButton}
                data-agent-action="open-quality-picker"
                aria-haspopup="dialog"
                aria-expanded={qualitySheetOpen}
                onClick={() => {
                  textareaRef.current?.blur();
                  setQualitySheetOpen(true);
                }}
              >
                <span>{`Quality: ${selectedQualityLabel}`}</span>
                <ChevronDown size={13} />
              </button>
            ) : null}
          </div>
        </div>
        </div>
      </>
    );
  },
);
