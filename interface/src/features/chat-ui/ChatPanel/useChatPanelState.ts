import { useState, useRef, useEffect, useCallback } from "react";
import { useScrollAnchorV2 } from "../../../shared/hooks/use-scroll-anchor-v2";
import { useIsStreaming } from "../../../hooks/stream/hooks";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import type { ChatInputBarHandle, AttachmentItem } from "../ChatInputBar";
import { useMessageQueueStore, useMessageQueue } from "../../../stores/message-queue-store";
import type { QueuedMessage } from "../../../stores/message-queue-store";
import type { AgentMentionTarget, ChatAttachment } from "../../../api/streams";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import { isGenerationCommand, type SlashCommand } from "../../../constants/commands";
import {
  desktopApi,
  DEFAULT_DEMO_RECORD_OPTIONS,
  type DemoRecordOptions,
} from "../../../shared/api/desktop";
import type { GenerationMode } from "../../../constants/models";
import { availableModelsForAdapter } from "../../../constants/models";
import { useDemoRecordStore } from "../../../stores/demo-record-store";
import { useChatUI, useChatUIStore } from "../../../stores/chat-ui-store";
import { useConversationSnapshot } from "../../../hooks/use-conversation-snapshot";
import {
  useLoadOlderMessages,
  type LoadOlderPageFetcher,
} from "../../../hooks/use-load-older-messages";
import { useChatViewStore, useThreadView } from "../../../stores/chat-view-store";
import {
  dispatch as dispatchResolvedSend,
  resolveSend,
  toQueuedRecord,
  type LegacyOnSend,
} from "./resolve-send";
import { findPrecedingUserMessage } from "../../../apps/chat/components/MessageActions/find-preceding-user-message";
import { registerRegenerateTurn } from "../../../apps/chat/components/MessageActions/regenerate-registry";

// Stable module-level empty defaults. Reusing the same array references on
// every reset (rather than allocating a fresh `[]`) lets `React.memo` on the
// chat input bar skip re-renders when only the active session changes — the
// session reset effect would otherwise hand the bar a brand-new `attachments`
// / `selectedCommands` array each time and defeat the shallow prop compare.
const EMPTY_ATTACHMENTS: AttachmentItem[] = [];
const EMPTY_COMMANDS: SlashCommand[] = [];

export interface UseChatPanelStateOptions {
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
    clientMessageId?: string,
  ) => void;
  /**
   * Cancels the in-flight turn. Required by the "Send now" affordance
   * in `MessageQueue` which short-circuits a queued prompt past the
   * current turn by aborting it and immediately dispatching the
   * chosen item. Optional so existing callers that never expose the
   * force-send button (e.g. the public chat surface) don't need to
   * thread a no-op through.
   */
  onStop?: () => void;
  adapterType?: string;
  defaultModel?: string | null;
  scrollResetKey?: unknown;
  scrollToBottomOnReset?: boolean;
  historyMessages?: DisplaySessionEvent[];
  selectedProjectId?: string;
  /**
   * Project id forwarded as `body.project_id` on the wire. Distinct
   * from `selectedProjectId` (which only drives the picker label and
   * chat-persistence anchor) so the agents-app can ship a different
   * project to the LLM than the one rendered in the picker — e.g.
   * Home for new sessions / context resets, or the originating
   * project for an existing session opened from a row that was
   * created elsewhere. Defaults to `selectedProjectId` when not set
   * so existing callers (projects app) keep their current behavior.
   */
  llmProjectId?: string;
  agentId?: string;
  sendDisabled?: boolean;
  /** Fetches one older history page for this thread (cursor-paginated). */
  loadOlderPage?: LoadOlderPageFetcher;
}

export function useChatPanelState({
  streamKey,
  transcriptKey,
  onSend,
  onStop,
  adapterType,
  defaultModel,
  scrollResetKey,
  scrollToBottomOnReset,
  historyMessages,
  selectedProjectId,
  llmProjectId,
  agentId,
  sendDisabled = false,
  loadOlderPage,
}: UseChatPanelStateOptions) {
  const wireProjectId = llmProjectId ?? selectedProjectId;
  // Imperative draft writes only. The live draft subscription lives in
  // the input bar wrapper (`DraftedInputBar`), so typing re-renders the
  // bar alone instead of the whole chat surface + transcript.
  const setDraft = useCallback(
    (value: string) => {
      useChatUIStore.getState().setDraft(streamKey, value);
    },
    [streamKey],
  );
  const [attachments, setAttachments] = useState<AttachmentItem[]>(EMPTY_ATTACHMENTS);
  const [commands, setCommands] = useState<SlashCommand[]>(EMPTY_COMMANDS);
  // Co-located with `commands` so the `/record_demo` send intercept can
  // read exactly what the `DemoRecordSettings` panel mutates.
  const [demoRecordOptions, setDemoRecordOptions] = useState<DemoRecordOptions>(
    DEFAULT_DEMO_RECORD_OPTIONS,
  );
  const availableModels = availableModelsForAdapter(adapterType);
  const chatUI = useChatUI(streamKey);
  const selectedModel = chatUI.selectedModel;
  const selectedMode = chatUI.selectedMode;
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const { isMobileLayout } = useAuraCapabilities();
  const attachmentsRef = useRef(attachments);
  const effectiveTranscriptKey = transcriptKey ?? streamKey;
  const { messages, bridgeMessages } = useConversationSnapshot({
    streamKey,
    transcriptKey: effectiveTranscriptKey,
    historyMessages,
  });
  const isStreaming = useIsStreaming(streamKey);
  const queue = useMessageQueue(streamKey);

  // Ref-mirror the live transcript so `handleRegenerateTurn` can resolve
  // the prompt preceding any assistant turn without re-creating the
  // callback (and re-registering it) on every streamed token.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chatUI.init(streamKey, adapterType, defaultModel, agentId);
  }, [streamKey, adapterType, defaultModel, agentId, chatUI.init]);

  const resetKeyMountRef = useRef(true);
  useEffect(() => {
    if (resetKeyMountRef.current) {
      resetKeyMountRef.current = false;
      return;
    }
    // Drafts live in `chat-ui-store.drafts` keyed by `streamKey`, so
    // switching sessions reads the new key's slot automatically and the
    // previous chat's unsent text survives a round trip. Attachments
    // and command chips still get wiped here — they carry per-session
    // upload / chip state that doesn't make sense outside the session
    // it was created in. Bail out of the writes when state is already
    // empty so the input bar's `React.memo` shallow-compare keeps
    // skipping re-renders on same-agent session switches.
    setAttachments((prev) => (prev.length === 0 ? prev : EMPTY_ATTACHMENTS));
    setCommands((prev) => (prev.length === 0 ? prev : EMPTY_COMMANDS));
  }, [scrollResetKey]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const { handleScroll, scrollToBottom, isAutoFollowing, getUserUnpinnedAt } =
    useScrollAnchorV2(messageAreaRef, {
      resetKey: scrollResetKey,
      scrollToBottomOnReset,
    });

  const { loadOlder, isLoadingOlder, hasOlderMessages } = useLoadOlderMessages({
    threadKey: effectiveTranscriptKey,
    fetchPage: loadOlderPage,
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
            source_url: a.fileUrl,
          }))
        : undefined;
    },
    [],
  );

  // Ref-mirror every value `handleSend` reads that's *not* `streamKey`.
  // Without this, `handleSend`'s identity churned on every selectedModel /
  // selectedMode / pinnedSourceImage / isStreaming / commands change and
  // cascaded into `<DesktopChatInputBar onSend={handleSend} />`, defeating
  // its `React.memo` whenever the user clicked between sessions of the
  // same agent. Identity is now stable per `streamKey`, which itself only
  // changes when the user switches agent (see `useStreamCore`).
  const onSendRef = useRef(onSend);
  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  // Mirror `onStop` so the "Send now" handler has a stable identity
  // for the queue UI's callback memo. Optional because not every
  // caller wires a stop handler.
  const onStopRef = useRef(onStop);
  useEffect(() => {
    onStopRef.current = onStop;
  }, [onStop]);

  const selectedModelRef = useRef(selectedModel);
  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  // Tracks the project id that should ride along with each send as
  // `body.project_id`. Decoupled from `selectedProjectId` so the
  // picker's "Home" label can stay even when the wire ships a
  // different (e.g. session-of-record) project. See `llmProjectId`
  // in this hook's options.
  const selectedProjectIdRef = useRef(wireProjectId);
  useEffect(() => {
    selectedProjectIdRef.current = wireProjectId;
  }, [wireProjectId]);

  const selectedModeRef = useRef(selectedMode);
  useEffect(() => {
    selectedModeRef.current = selectedMode;
  }, [selectedMode]);

  const pinnedSourceImageRef = useRef(chatUI.pinnedSourceImage);
  useEffect(() => {
    pinnedSourceImageRef.current = chatUI.pinnedSourceImage;
  }, [chatUI.pinnedSourceImage]);

  const commandsRef = useRef(commands);
  useEffect(() => {
    commandsRef.current = commands;
  }, [commands]);

  const demoRecordOptionsRef = useRef(demoRecordOptions);
  useEffect(() => {
    demoRecordOptionsRef.current = demoRecordOptions;
  }, [demoRecordOptions]);

  const isStreamingRef = useRef(isStreaming);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const sendDisabledRef = useRef(sendDisabled);
  useEffect(() => {
    sendDisabledRef.current = sendDisabled;
  }, [sendDisabled]);

  const scrollToBottomRef = useRef(scrollToBottom);
  useEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
  }, [scrollToBottom]);

  const handleSend = useCallback(
    (
      content: string,
      action?: string,
      atts?: AttachmentItem[],
      // genMode is accepted for backwards compatibility with callers
      // that still thread it explicitly (e.g. the unit tests). When
      // present, it overrides the store-derived mode for this single
      // send only — the store remains the persistent source of truth.
      genMode?: GenerationMode,
      agentMentions?: AgentMentionTarget[],
    ) => {
      if (sendDisabledRef.current) {
        return;
      }
      setDraft("");
      const apiAttachments = buildApiAttachments(atts) ?? [];
      const userCommandIds = commandsRef.current.map((c) => c.id);

      // `/record_demo` is a desktop-only native action, not a chat turn:
      // it opens a fresh AURA window, runs the typed instruction there,
      // and screen-records it. Intercept before the normal send pipeline.
      if (userCommandIds.includes("record_demo")) {
        setCommands((prev) => {
          const next = prev.filter((c) => c.id !== "record_demo");
          if (next.length === prev.length) return prev;
          return next.length === 0 ? EMPTY_COMMANDS : next;
        });
        const instruction = content.trim();
        if (instruction.length > 0) {
          const options = demoRecordOptionsRef.current;
          void desktopApi
            .startDemoRecording(instruction, options)
            .then((res) => {
              // Preflight failures (missing ffmpeg, or — on macOS — Screen
              // Recording permission) come back as `{ ok:false, kind }`.
              // Surface a self-service setup modal instead of failing
              // silently; it can locate ffmpeg / open System Settings and
              // retry the same instruction + options.
              if (res && res.ok === false && res.kind) {
                useDemoRecordStore.getState().requestSetup({
                  kind: res.kind,
                  message: res.error ?? "Demo recording could not start.",
                  instruction,
                  options,
                });
              }
            })
            .catch(() => {
              // Best-effort: the desktop route is unavailable in the web build.
            });
        }
        return;
      }

      // Translate the active mode (with optional per-call override)
      // into a fully-typed `ResolvedSend` variant.
      const overrideMode =
        genMode === "image"
          ? ("image" as const)
          : genMode === "3d"
            ? ("3d" as const)
            : undefined;
      const effectiveAgentMode = overrideMode ?? selectedModeRef.current;

      // Read the pinned source image straight from the chat-ui store
      // so the request reflects exactly what the input bar's thumb
      // shows, and ignores any image that may have landed in the
      // chat history after the user removed the pin.
      const pinnedSourceImageUrl =
        pinnedSourceImageRef.current?.imageUrl ?? null;

      const resolved = resolveSend({
        mode: effectiveAgentMode,
        content,
        selectedModel: selectedModelRef.current,
        attachments: apiAttachments,
        userCommandIds,
        pinnedSourceImageUrl,
      });

      // Reset to module-level empties when not already empty, so React
      // sees a stable reference and the input bar's memo can short-circuit.
      setAttachments((prev) =>
        prev.length === 0 ? prev : EMPTY_ATTACHMENTS,
      );
      // Drop non-generation chips (the panel's transient chip row);
      // generation modes own that signal via the selector now.
      setCommands((prev) => {
        const next = prev.filter((c) => isGenerationCommand(c.id));
        if (next.length === prev.length) return prev;
        return next.length === 0 ? EMPTY_COMMANDS : next;
      });

      // An explicit `action` from the caller (e.g. inline "Generate
      // specs" buttons) wins over the mode-supplied one. The override
      // is applied at the wire boundary, not by mutating a variant,
      // so the discriminated union stays honest.
      const overrideAction: string | null = action ?? null;

      if (isStreamingRef.current) {
        const record = toQueuedRecord(resolved);
        useMessageQueueStore.getState().enqueue(streamKey, {
          content: record.content,
          action: overrideAction ?? record.action,
          model: record.model,
          attachments: record.attachments,
          commands: record.commands,
          generationMode: record.generationMode,
          sourceImageUrl: record.sourceImageUrl,
          agentMentions,
        });
      } else {
        scrollToBottomRef.current();
        if (overrideAction !== null) {
          // Caller supplied an explicit action; bypass the mode's
          // action and pass everything else through unchanged.
          const record = toQueuedRecord(resolved);
          (onSendRef.current as LegacyOnSend)(
            record.content,
            overrideAction,
            record.model,
            record.attachments,
            record.commands,
            selectedProjectIdRef.current,
            record.generationMode,
            record.sourceImageUrl,
            agentMentions,
          );
        } else {
          dispatchResolvedSend(
            resolved,
            onSendRef.current as LegacyOnSend,
            selectedProjectIdRef.current,
            agentMentions,
          );
        }
      }
    },
    [buildApiAttachments, setDraft, streamKey],
  );

  // Per-turn regenerate. Finds the user prompt immediately preceding the
  // target assistant message and re-sends it through the existing send
  // path (mirrors `handleRetryLastSend`: stop, then `onSend`) so no
  // SSE/stream logic is duplicated. Registered in the regenerate
  // registry keyed by `streamKey` so the `MessageActions` facade hook can
  // trigger it without prop-drilling through the message list.
  const handleRegenerateTurn = useCallback((assistantMessageId: string) => {
    if (sendDisabledRef.current) return;
    const content = findPrecedingUserMessage(
      messagesRef.current,
      assistantMessageId,
    );
    if (!content) return;
    const stop = onStopRef.current;
    if (stop) stop();
    onSendRef.current(
      content,
      null,
      selectedModelRef.current,
      undefined,
      undefined,
      selectedProjectIdRef.current,
      undefined,
      undefined,
    );
    scrollToBottomRef.current();
  }, []);

  useEffect(
    () => registerRegenerateTurn(streamKey, handleRegenerateTurn),
    [streamKey, handleRegenerateTurn],
  );

  const prevStreamingRef = useRef(false);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const next = useMessageQueueStore.getState().dequeue(streamKey);
      if (next) {
        if (sendDisabledRef.current) {
          prevStreamingRef.current = isStreaming;
          return;
        }
        onSendRef.current(
          next.content,
          next.action,
          next.model ?? selectedModelRef.current,
          next.attachments,
          next.commands,
          selectedProjectIdRef.current,
          next.generationMode,
          next.sourceImageUrl,
          next.agentMentions,
          next.id,
        );
        scrollToBottomRef.current();
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [adapterType, isStreaming, streamKey]);

  const handleQueueEdit = useCallback(
    (item: QueuedMessage) => {
      useMessageQueueStore.getState().remove(streamKey, item.id);
      setDraft(item.content);
      requestAnimationFrame(() => inputBarRef.current?.focus());
    },
    [setDraft, streamKey],
  );

  const handleQueueRemove = useCallback(
    (id: string) => useMessageQueueStore.getState().remove(streamKey, id),
    [streamKey],
  );

  // Force-send a queued prompt past the current turn. The handler
  // (1) removes the item from the queue so the regular
  // dequeue-on-completion effect doesn't replay it from the head
  // when `isStreaming` flips, (2) calls `onStop` to abort the
  // in-flight turn — which is wired through `stopStreaming` and
  // synchronously clears the per-partition in-flight latch
  // (`inFlightRef` / `ctrl.inFlight`) so the very next dispatch
  // doesn't get swallowed by the re-entry guard — and (3) dispatches
  // the chosen prompt inline. React 18 batches the
  // `setIsStreaming(false)` from `stopStreaming` with the
  // `setIsStreaming(true)` issued by the new send, so the dequeue
  // effect never sees a `true → false` transition and there's no
  // competing replay.
  const handleQueueSendNow = useCallback(
    (item: QueuedMessage) => {
      if (sendDisabledRef.current) {
        return;
      }
      useMessageQueueStore.getState().remove(streamKey, item.id);
      const stop = onStopRef.current;
      if (stop) stop();
      onSendRef.current(
        item.content,
        item.action,
        item.model ?? selectedModelRef.current,
        item.attachments,
        item.commands,
        selectedProjectIdRef.current,
        item.generationMode,
        item.sourceImageUrl,
        item.agentMentions,
        item.id,
      );
      scrollToBottomRef.current();
    },
    [streamKey],
  );

  return {
    attachments,
    setAttachments,
    commands,
    setCommands,
    demoRecordOptions,
    setDemoRecordOptions,
    messageAreaRef,
    inputBarRef,
    isMobileLayout,
    handleScroll,
    isAutoFollowing,
    getUserUnpinnedAt,
    isStreaming,
    queue,
    messages,
    bridgeMessages,
    scrollToBottom,
    handleRemoveAttachment,
    handleSend,
    handleQueueEdit,
    handleQueueRemove,
    handleQueueSendNow,
    loadOlder,
    isLoadingOlder,
    hasOlderMessages,
    unreadCount,
  };
}
