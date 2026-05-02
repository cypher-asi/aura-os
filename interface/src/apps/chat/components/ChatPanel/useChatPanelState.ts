import { useState, useRef, useEffect, useCallback } from "react";
import { useScrollAnchorV2 } from "../../../../shared/hooks/use-scroll-anchor-v2";
import { useIsStreaming } from "../../../../hooks/stream/hooks";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import type { ChatInputBarHandle, AttachmentItem } from "../ChatInputBar";
import { useMessageQueueStore, useMessageQueue } from "../../../../stores/message-queue-store";
import type { QueuedMessage } from "../../../../stores/message-queue-store";
import type { ChatAttachment } from "../../../../api/streams";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";
import { isGenerationCommand, type SlashCommand } from "../../../../constants/commands";
import type { GenerationMode } from "../../../../constants/models";
import { availableModelsForAdapter } from "../../../../constants/models";
import { useChatUI } from "../../../../stores/chat-ui-store";
import { useConversationSnapshot } from "../../../../hooks/use-conversation-snapshot";
import { useLoadOlderMessages } from "../../../../hooks/use-load-older-messages";
import { useChatViewStore, useThreadView } from "../../../../stores/chat-view-store";

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
  scrollToBottomOnReset?: boolean;
  historyMessages?: DisplaySessionEvent[];
  selectedProjectId?: string;
  agentId?: string;
}

export function useChatPanelState({
  streamKey,
  onSend,
  adapterType,
  defaultModel,
  scrollResetKey,
  scrollToBottomOnReset,
  historyMessages,
  selectedProjectId,
  agentId,
}: UseChatPanelStateOptions) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const availableModels = availableModelsForAdapter(adapterType);
  const chatUI = useChatUI(streamKey);
  const selectedModel = chatUI.selectedModel;
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const { isMobileLayout } = useAuraCapabilities();
  const attachmentsRef = useRef(attachments);
  const { messages } = useConversationSnapshot(streamKey, historyMessages);
  const isStreaming = useIsStreaming(streamKey);
  const queue = useMessageQueue(streamKey);

  useEffect(() => {
    chatUI.init(streamKey, adapterType, defaultModel, agentId);
  }, [streamKey, adapterType, defaultModel, agentId, chatUI.init]);

  const resetKeyMountRef = useRef(true);
  useEffect(() => {
    if (resetKeyMountRef.current) {
      resetKeyMountRef.current = false;
      return;
    }
    setInput("");
    setAttachments([]);
    setCommands([]);
  }, [scrollResetKey]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const { handleScroll, scrollToBottom, isAutoFollowing } = useScrollAnchorV2(
    messageAreaRef,
    { resetKey: scrollResetKey, scrollToBottomOnReset },
  );

  const { loadOlder, isLoadingOlder, hasOlderMessages } = useLoadOlderMessages({
    threadKey: streamKey,
    agentId,
  });

  const threadView = useThreadView(streamKey);
  const unreadCount = threadView.unreadCount;

  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (messages.length > prevCount && !isAutoFollowing) {
      const newCount = messages.length - prevCount;
      for (let i = 0; i < newCount; i++) {
        useChatViewStore.getState().incrementUnread(streamKey);
      }
    }
  }, [messages.length, isAutoFollowing, streamKey]);

  useEffect(() => {
    if (isAutoFollowing) {
      useChatViewStore.getState().resetUnread(streamKey);
    }
  }, [isAutoFollowing, streamKey]);

  useEffect(() => {
    chatUI.syncAvailableModels(streamKey, adapterType, defaultModel, agentId);
  }, [
    adapterType,
    defaultModel,
    availableModels,
    chatUI.syncAvailableModels,
    streamKey,
    agentId,
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
          ? commands.map((c) => c.id)
          : undefined;
      const effectiveGenMode =
        genMode ??
        (commands.some((c) => c.id === "generate_image")
          ? ("image" as GenerationMode)
          : commands.some((c) => c.id === "generate_3d")
            ? ("3d" as GenerationMode)
            : undefined);
      const runtimeModel =
        effectiveGenMode === "image"
          ? selectedModel
          : effectiveGenMode
            ? null
            : selectedModel;
      setAttachments([]);
      setCommands((prev) => prev.filter((c) => isGenerationCommand(c.id)));

      if (isStreaming) {
        useMessageQueueStore.getState().enqueue(streamKey, {
          content,
          action: action ?? null,
          model: runtimeModel,
          attachments: apiAttachments,
          commands: commandIds,
          generationMode: effectiveGenMode,
        });
        scrollToBottom();
      } else {
        scrollToBottom();
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
          next.model ?? selectedModelRef.current,
          next.attachments,
          next.commands,
          selectedProjectIdRef.current,
          next.generationMode,
        );
        scrollToBottom();
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [adapterType, isStreaming, streamKey, scrollToBottom]);

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
    inputBarRef,
    isMobileLayout,
    handleScroll,
    isAutoFollowing,
    isStreaming,
    queue,
    messages,
    scrollToBottom,
    handleRemoveAttachment,
    handleSend,
    handleQueueEdit,
    handleQueueMoveUp,
    handleQueueRemove,
    loadOlder,
    isLoadingOlder,
    hasOlderMessages,
    unreadCount,
  };
}
