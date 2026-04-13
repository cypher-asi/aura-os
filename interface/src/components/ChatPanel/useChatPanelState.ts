import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useScrollAnchor } from "../../hooks/use-scroll-anchor";
import { useIsStreaming, useStreamEvents } from "../../hooks/stream/hooks";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import type { ChatInputBarHandle, AttachmentItem } from "../ChatInputBar";
import { useMessageQueueStore, useMessageQueue } from "../../stores/message-queue-store";
import type { QueuedMessage } from "../../stores/message-queue-store";
import type { ChatAttachment } from "../../api/streams";
import type { DisplaySessionEvent } from "../../types/stream";
import type { SlashCommand } from "../../constants/commands";
import { isGenerationCommand } from "../../constants/commands";
import type { GenerationMode } from "../../constants/models";
import { availableModelsForAdapter } from "../../constants/models";
import { useChatUI } from "../../stores/chat-ui-store";

export interface UseChatPanelStateOptions {
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
  adapterType?: string;
  defaultModel?: string | null;
  scrollResetKey?: unknown;
  historyMessages?: DisplaySessionEvent[];
  selectedProjectId?: string;
}

function combineHistoryAndStreamMessages(
  historyMessages: DisplaySessionEvent[] | undefined,
  streamMessages: DisplaySessionEvent[],
): DisplaySessionEvent[] {
  if (!historyMessages || historyMessages.length === 0) {
    return streamMessages;
  }
  if (streamMessages.length === 0) {
    return historyMessages;
  }

  const historyIds = new Set(historyMessages.map((message) => message.id));
  const liveOnlyMessages = streamMessages.filter((message) => !historyIds.has(message.id));
  if (liveOnlyMessages.length === 0) {
    return historyMessages;
  }
  return [...historyMessages, ...liveOnlyMessages];
}

export function useChatPanelState({
  streamKey,
  onSend,
  adapterType,
  defaultModel,
  scrollResetKey,
  historyMessages,
  selectedProjectId,
}: UseChatPanelStateOptions) {
  const [input, setInput] = useState("");
  const availableModels = availableModelsForAdapter(adapterType);
  const chatUI = useChatUI(streamKey);
  useEffect(() => {
    chatUI.init(streamKey, adapterType, defaultModel);
  }, [streamKey, adapterType, defaultModel, chatUI.init]);
  const selectedModel = chatUI.selectedModel;
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const { isMobileLayout } = useAuraCapabilities();
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const {
    handleScroll,
    scrollToBottom: _scrollToBottom,
    scrollToBottomIfPinned,
    scrollToTop,
    holdPosition,
    isReady,
    isAutoFollowing,
  } = useScrollAnchor(messageAreaRef, scrollSentinelRef, {
    resetKey: scrollResetKey,
    contentReady: true,
  });

  const scrollToBottom = useCallback(() => {
    if (spacerRef.current) spacerRef.current.style.minHeight = "0";
    _scrollToBottom();
  }, [_scrollToBottom]);

  const isStreaming = useIsStreaming(streamKey);
  const queue = useMessageQueue(streamKey);
  const streamMessages = useStreamEvents(streamKey);
  const messages = useMemo(
    () => combineHistoryAndStreamMessages(historyMessages, streamMessages),
    [historyMessages, streamMessages],
  );
  const prevMessageCountRef = useRef(messages.length);
  const pendingScrollToTopRef = useRef(false);

  useEffect(() => {
    if (
      messages.length > prevMessageCountRef.current &&
      pendingScrollToTopRef.current
    ) {
      pendingScrollToTopRef.current = false;
      const lastIndex = messages.length - 1;
      const el = messageAreaRef.current?.querySelector<HTMLElement>(
        `[data-index="${lastIndex}"]`,
      );
      if (el) {
        const container = messageAreaRef.current;
        if (container && spacerRef.current) {
          spacerRef.current.style.minHeight = `${container.clientHeight}px`;
        }
        scrollToTop(el);
        holdPosition();
      } else {
        scrollToBottom();
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, scrollToTop, scrollToBottom, holdPosition]);

  useEffect(() => {
    if (isMobileLayout) return;
    requestAnimationFrame(() => inputBarRef.current?.focus());
  }, [isMobileLayout, scrollResetKey]);

  useEffect(() => {
    chatUI.syncAvailableModels(streamKey, adapterType, defaultModel);
  }, [
    adapterType,
    defaultModel,
    availableModels,
    chatUI.syncAvailableModels,
    streamKey,
  ]);

  const handleRemoveAttachment = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [],
  );

  const buildApiAttachments = useCallback(
    (atts?: AttachmentItem[]): ChatAttachment[] | undefined => {
      const toSend = atts ?? attachmentsRef.current;
      return toSend.length > 0
        ? toSend.map((a) => ({
            type: a.attachmentType,
            media_type: a.mediaType,
            data: a.data,
            name: a.name,
          }))
        : undefined;
    },
    [],
  );

  const handleSend = useCallback(
    (
      content: string,
      action?: string,
      atts?: AttachmentItem[],
      genMode?: GenerationMode,
    ) => {
      setInput("");
      const apiAttachments = buildApiAttachments(atts);
      const commandIds =
        commands.length > 0
          ? commands.map((c) => c.id).filter((id) => !isGenerationCommand(id))
          : undefined;
      const effectiveGenMode =
        genMode ??
        (commands.some((c) => c.id === "generate_image")
          ? ("image" as GenerationMode)
          : commands.some((c) => c.id === "generate_3d")
            ? ("3d" as GenerationMode)
            : undefined);
      const runtimeModel = adapterType === "codex" ? null : selectedModel;
      setAttachments([]);
      setCommands([]);

      if (isStreaming) {
        useMessageQueueStore.getState().enqueue(streamKey, {
          content,
          action: action ?? null,
          attachments: apiAttachments,
          commands: commandIds,
        });
        scrollToBottom();
      } else {
        pendingScrollToTopRef.current = true;
        onSend(
          content,
          action ?? null,
          runtimeModel,
          apiAttachments,
          commandIds,
          selectedProjectId,
          effectiveGenMode,
        );
      }
    },
    [
      adapterType,
      buildApiAttachments,
      commands,
      isStreaming,
      onSend,
      scrollToBottom,
      selectedModel,
      selectedProjectId,
      streamKey,
    ],
  );

  const prevStreamingRef = useRef(false);
  const onSendRef = useRef(onSend);
  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  const selectedModelRef = useRef(selectedModel);
  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  const selectedProjectIdRef = useRef(selectedProjectId);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const next = useMessageQueueStore.getState().dequeue(streamKey);
      if (next) {
        onSendRef.current(
          next.content,
          next.action,
          adapterType === "codex" ? null : selectedModelRef.current,
          next.attachments,
          next.commands,
          selectedProjectIdRef.current,
        );
        scrollToBottom();
      } else {
        requestAnimationFrame(() => scrollToBottomIfPinned());
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [adapterType, isStreaming, streamKey, scrollToBottom, scrollToBottomIfPinned]);

  const handleQueueEdit = useCallback(
    (item: QueuedMessage) => {
      useMessageQueueStore.getState().remove(streamKey, item.id);
      setInput(item.content);
      requestAnimationFrame(() => inputBarRef.current?.focus());
    },
    [streamKey],
  );

  const handleQueueMoveUp = useCallback(
    (id: string) => useMessageQueueStore.getState().moveUp(streamKey, id),
    [streamKey],
  );

  const handleQueueRemove = useCallback(
    (id: string) => useMessageQueueStore.getState().remove(streamKey, id),
    [streamKey],
  );

  return {
    input,
    setInput,
    attachments,
    setAttachments,
    commands,
    setCommands,
    messageAreaRef,
    scrollSentinelRef,
    spacerRef,
    inputBarRef,
    isMobileLayout,
    handleScroll,
    isReady,
    isAutoFollowing,
    isStreaming,
    queue,
    messages,
    handleRemoveAttachment,
    handleSend,
    handleQueueEdit,
    handleQueueMoveUp,
    handleQueueRemove,
  };
}
