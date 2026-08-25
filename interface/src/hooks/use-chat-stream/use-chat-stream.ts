import { useRef, useCallback, useEffect } from "react";
import type { MutableRefObject } from "react";
import { api } from "../../api/client";
import {
  attachToStream,
  generate3dStream,
  generateImageStream,
  generateVideoStream,
  selectReattachableChatStream,
} from "../../api/streams";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import { useChatUIStore } from "../../stores/chat-ui-store";
import type { ChatAttachment, StreamEventHandler } from "../../api/streams";
import {
  DEFAULT_IMAGE_MODEL_ID,
  modelSupportsQuality,
  type GenerationMode,
} from "../../constants/models";
import {
  persistedReasoningEffort,
  supportedReasoningEffort,
} from "../../lib/model-effort";
import { STYLE_LOCK_SUFFIX } from "../../constants/generation";
import { EventType } from "../../shared/types/aura-events";
import {
  recordStreamCloseReason,
  type StreamCloseContext,
} from "../../shared/observability/stream-breadcrumbs";

import {
  useStreamCore,
  resetStreamBuffers,
  handleStreamError,
  getIsStreaming,
} from "../use-stream-core";
import {
  ensureEntry,
  createSetters,
  getLastEventAt,
  FRESH_SESSION_PLACEHOLDER,
  keyForProjectSession,
} from "../stream/store";
import { STUCK_THRESHOLD_MS } from "../stream/use-stream-health";
import { useMessageQueueStore } from "../../stores/message-queue-store";
import { buildUserChatMessage } from "../attachment-helpers";
import { buildStreamHandler } from "./build-stream-handler";
import {
  getPartitionSendControl,
  type LastSendArgs,
} from "./partition-send-control";
import type { ActiveStreamSummary } from "../../shared/api/streams";

// Phase 2 auto-retry plumbing. When a chat turn dies mid-stream
// because the harness WS dropped (or the SSE idle watchdog fires),
// we silently re-issue the last user message on a fresh harness
// session — the harness rebuilds context from `aura_session_id` in
// storage. Bounded to `MAX_AUTO_RETRIES` to avoid hammering a
// genuinely-down upstream. The counter resets on every successfully
// completed turn (see `onAssistantTurnCompleted`), so this bounds
// *consecutive* failed retries, not a session lifetime. Raised from 2
// to 4 so a flaky long session (the repeated-manual-retry symptom)
// recovers on its own instead of stranding the user on a red banner.
const MAX_AUTO_RETRIES = 4;

interface UseChatStreamOptions {
  projectId: string | undefined;
  agentInstanceId: string | undefined;
  /**
   * Pin this stream's send + SessionReady handling to a specific
   * historical session id. When set, every `sendMessage` is forwarded
   * to the server with `session_id=<id>` so the harness writes into
   * that exact session and rebuilds LLM context from its events. The
   * `+` button drops this back to `undefined` (URL `?session=` is
   * cleared upstream); the next send creates a fresh session and
   * `onSessionReady` fires with the new id.
   */
  sessionId?: string | null;
  /**
   * Called once per `SessionReady` whenever the server-assigned
   * session id changes. Replaces the old `useLiveSessionStore` pin
   * mechanism: the chat panel uses this to write `?session=<new-id>`
   * into the URL (via `setSearchParams({ replace: true })`), making
   * the URL the single source of truth for which session is being
   * extended.
   */
  onSessionReady?: (sessionId: string) => void;
  /**
   * Whether workspace tools such as dev-loop bridging are reachable in the
   * current client. Plain chat can remain enabled even when this is false.
   */
  workspaceToolsEnabled?: boolean;
  workspaceStartAgentInstanceId?: string;
  /** Route project turns through the session's isolated Git worktree. */
  safeWorkspace?: boolean;
}

/** Captured partition-of-record. The send and any auto-retry replay
 *  fired by it always write to THIS partition's slot, even if the
 *  hook's `core.key` has since changed because the panel swapped
 *  agents. */
interface CapturedPartition {
  key: string;
  projectId: string;
  instanceId: string;
}

export function useChatStream({
  projectId,
  agentInstanceId,
  sessionId,
  onSessionReady,
  workspaceToolsEnabled = true,
  workspaceStartAgentInstanceId,
  safeWorkspace = false,
}: UseChatStreamOptions) {
  const sidekickRef = useRef(useSidekickStore.getState());
  const projectCtx = useProjectActions();
  const projectCtxRef = useRef(projectCtx);

  useEffect(() => useSidekickStore.subscribe((s) => { sidekickRef.current = s; }), []);
  useEffect(() => { projectCtxRef.current = projectCtx; }, [projectCtx]);

  // Phase 3: thread `sessionId` into the partition deps so each
  // storage session of the same agent instance gets its own client
  // streamKey. `sessionId ?? FRESH_SESSION_PLACEHOLDER` gives a
  // freshly-opened canvas (no session id yet) a deterministic
  // placeholder lane that survives until `SessionReady` migrates it
  // via `migrateChatPartition` to the real session id. Two sessions
  // of the same instance can now stream concurrently without sharing
  // isStreaming, abort, or partition-send-control state.
  const core = useStreamCore([projectId, agentInstanceId, sessionId ?? FRESH_SESSION_PLACEHOLDER]);
  // `sessionId` and `onSessionReady` change whenever the URL
  // `?session=` flips. Reading them via refs in `sendMessage` keeps
  // the callback identity stable so the chat input bar's
  // `useCallback`s don't re-run on every URL update.
  const sessionIdRef = useRef(sessionId ?? null);
  useEffect(() => {
    sessionIdRef.current = sessionId ?? null;
    // No explicit pin clear is needed here. `markNextSendAsNewSession`
    // now writes the flag onto the lane's *fresh-canvas* partition
    // (`keyForProjectSession(projectId, agentInstanceId, null)`), so
    // when the user presses "+", clicks a prior session row before
    // sending, and then sends — `core.key` is the real-session
    // partition `…:s-old` whose `nextSendStartsNewSession` was never
    // written to. The pin is naturally dropped without touching the
    // fresh-canvas entry (which stays armed so a subsequent "+" press
    // still works as expected).
  }, [sessionId]);
  const onSessionReadyRef = useRef(onSessionReady);
  useEffect(() => { onSessionReadyRef.current = onSessionReady; }, [onSessionReady]);
  const workspaceToolsEnabledRef = useRef(workspaceToolsEnabled);
  useEffect(() => {
    workspaceToolsEnabledRef.current = workspaceToolsEnabled;
  }, [workspaceToolsEnabled]);
  const workspaceStartAgentInstanceIdRef = useRef(workspaceStartAgentInstanceId);
  useEffect(() => {
    workspaceStartAgentInstanceIdRef.current = workspaceStartAgentInstanceId;
  }, [workspaceStartAgentInstanceId]);
  const safeWorkspaceRef = useRef(safeWorkspace);
  useEffect(() => {
    safeWorkspaceRef.current = safeWorkspace;
  }, [safeWorkspace]);

  // Track the partition key this hook is currently bound to so the
  // unmount cleanup can hygienically clear THIS hook's last partition's
  // pending retry timer (the partition entry itself stays intact in the
  // partition-send-control map; only the dangling timer is killed).
  const currentKeyRef = useRef(core.key);
  useEffect(() => { currentKeyRef.current = core.key; }, [core.key]);

  useEffect(
    () => () => {
      const ctrl = getPartitionSendControl(currentKeyRef.current);
      if (ctrl.retryTimer != null) {
        clearTimeout(ctrl.retryTimer);
        ctrl.retryTimer = null;
      }
    },
    [],
  );

  useEffect(() => () => {
    if (agentInstanceId && !getIsStreaming(core.key)) {
      sidekickRef.current.setAgentStreaming(agentInstanceId, false);
    }
  }, [projectId, agentInstanceId, core.key]);

  // Forward ref to `tryReattachActiveTurn` (defined after `performSend`
  // so it can reference `performSendRef` for its re-POST fallback).
  // `performSend`'s auto-retry timer reads this to prefer rejoining a
  // still-live server turn before re-issuing the POST. Initialised to
  // `null`; assigned via an effect once the callback exists.
  const tryReattachActiveTurnRef = useRef<
    ((captured: CapturedPartition) => Promise<boolean>) | null
  >(null);

  /**
   * Core send routine. Always writes to the OWNING partition's slot
   * (specified by `captured`) regardless of which partition the panel
   * is currently rendering. Both the user-facing `sendMessage` and the
   * auto-retry timer route through here so a transient SSE drop on
   * agent A recovers cleanly even after the panel has switched to
   * agent B.
   */
  const performSend = useCallback(
    async (args: LastSendArgs, captured: CapturedPartition) => {
      const { key: capturedKey, projectId: capturedProjectId, instanceId: capturedInstanceId } = captured;

      // Phase 3: the partition key may flip mid-turn when the server
      // emits `SessionReady` for a fresh-canvas first send (placeholder
      // `…:fresh` → real session id) or auto-forks past the context
      // budget (`progress { kind: "auto_fork", … }`). All in-flight
      // setter, store-read, and migration sites read the *current*
      // partition key off this holder so they follow the migration
      // without rebinding a captured closure.
      const partitionState = { key: capturedKey };
      const getPartitionKey = (): string => partitionState.key;

      const partitionMeta = ensureEntry(capturedKey);
      const partitionRefs = partitionMeta.refs;
      // Pass a getter so the setters always target whatever the current
      // partition key is — see `migrateStreamPartition` callers.
      const partitionSetters = createSetters(getPartitionKey);
      // The `ctrl` object reference is preserved across migration
      // (`migratePartitionSendControl` re-keys the map but reuses the
      // same object), so capturing it once here is correct even when
      // the key flips mid-turn.
      const ctrl = getPartitionSendControl(capturedKey);
      // Phase 5: snapshot the breadcrumb context for this turn so
      // every `handleStreamError` / `finalizeStream` call inside
      // the captured-partition closure stamps the persisted ring
      // entry with the originating stream key + session id. The
      // project-chat hook is now keyed on `(projectId,
      // agentInstanceId, sessionId)`. The breadcrumb's `streamKey`
      // mirrors the live partition key so a post-migration breadcrumb
      // points at the new lane rather than the stale fresh-canvas one.
      const breadcrumbContext: StreamCloseContext = {
        get streamKey() { return partitionState.key; },
        agentId: capturedInstanceId,
        sessionId: sessionIdRef.current ?? undefined,
      };

      // Per-partition entry latch. The synchronous `inFlight` flip
      // covers the gap between this call and the moment
      // `setIsStreaming(true)` propagates through Zustand: two clicks
      // (or a click + queue-dequeue replay) landing in the same
      // microtask both pass the `getIsStreaming` read and would
      // otherwise issue parallel POSTs. Per-partition keying is what
      // makes parallel chats work — agent A's in-flight latch never
      // blocks agent B's send.
      if (ctrl.inFlight) return;
      // Stream is already in flight on this partition. Instead of a
      // silent drop, enqueue into the per-key message queue so the
      // existing dequeue-on-completion effect in `useChatPanelState`
      // re-fires it once the current turn ends. Auto-retry replays
      // hit this path very rarely (only if a fresh user send raced
      // with the retry timer); enqueueing them is still preferable
      // to dropping. Stuck streams (>= STUCK_THRESHOLD_MS without a
      // wire event) stamp `pendingDueToStuckStream` so the Phase 2
      // banner can offer "Send anyway".
      if (getIsStreaming(getPartitionKey())) {
        const lastEventAt = getLastEventAt(getPartitionKey());
        const isStuck =
          lastEventAt != null && Date.now() - lastEventAt >= STUCK_THRESHOLD_MS;
        useMessageQueueStore.getState().enqueue(getPartitionKey(), {
          content: args.content,
          action: args.action ?? null,
          model: args.selectedModel ?? null,
          attachments: args.attachments,
          commands: args.commands,
          generationMode: args.generationMode,
          sourceImageUrl: args.sourceImageUrl,
          agentMentions: args.agentMentions,
          pendingDueToStuckStream: isStuck,
        });
        return;
      }

      // A user-initiated send (not the auto-retry timer firing) resets
      // the Phase 2 retry budget. Otherwise a user that exhausted the
      // budget once would never get a retry on their next message
      // even after a clean break.
      const isAutoRetry = ctrl.inAutoRetry;
      ctrl.inAutoRetry = false;
      if (!isAutoRetry) {
        ctrl.autoRetryCount = 0;
      }

      // Capture every successful entry so the Phase 2 auto-retry path
      // can re-issue the exact same call after a transient WS drop.
      // Snapshot BEFORE the empty-content guard because the retry
      // needs the original payload regardless of whether the user
      // typed text vs. relied on attachments.
      ctrl.lastSendArgs = args;

      const {
        content,
        action,
        selectedModel,
        attachments,
        commands,
        projectIdOverride: _projectIdOverride,
        generationMode: _generationMode,
        sourceImageUrl: _sourceImageUrl,
        agentMentions,
        clientMessageId,
      } = args;
      void _projectIdOverride;

      const trimmed = content.trim();
      // 3D model step (`generationMode === "3d"` with a pinned source image)
      // dispatches without text or attachments — the source image is the
      // payload — so let it through the empty-content guard.
      const is3DModelStep =
        _generationMode === "3d" && typeof _sourceImageUrl === "string" && _sourceImageUrl.length > 0;
      if (
        !trimmed &&
        !action &&
        !(attachments && attachments.length > 0) &&
        !is3DModelStep
      )
        return;

      ctrl.inFlight = true;

      const userMsg = buildUserChatMessage(
        trimmed,
        attachments,
        action === "generate_specs"
          ? "Generate specs for this project"
          : is3DModelStep
            ? "Generate 3D model"
            : undefined,
        clientMessageId,
      );
      // On an auto-retry, the user's bubble is already on screen from
      // the original send — only the assistant turn is being re-issued
      // — so re-appending it here would duplicate the question. The
      // partial assistant buffer was already discarded in `tryAutoRetry`.
      if (!isAutoRetry) {
        partitionSetters.setEvents((prev) => [...prev, userMsg]);
      }
      partitionSetters.setIsStreaming(true);
      sidekickRef.current.setAgentStreaming(capturedInstanceId, true);
      resetStreamBuffers(partitionRefs, partitionSetters);
      ctrl.pendingSpecIds = [];
      ctrl.pendingTaskIds = [];

      if (action === "generate_specs") {
        sidekickRef.current.clearGeneratedArtifacts();
        // Auto-jump to Specs so the user can watch generation, BUT
        // never yank them off Sessions. Picking Sessions is an explicit
        // "I want to follow the chat" signal; flipping the sidekick on
        // every Plan-mode send made the Sessions tab unusable in
        // practice. Other tabs (terminal/browser/stats/log/files/run)
        // aren't tied to the chat stream, so the discoverability jump
        // to Specs is still the right call from there.
        if (sidekickRef.current.activeTab !== "sessions") {
          sidekickRef.current.setActiveTab("specs");
        }
      }

      // Abort any prior in-flight controller on THIS partition. Cross-
      // partition controllers stay untouched so agent A keeps streaming
      // when the user fires a fresh send on agent B.
      ctrl.currentController?.abort();
      const controller = new AbortController();
      ctrl.currentController = controller;

      // Shim refs around partition-keyed mutable state so existing
      // handlers (`buildStreamHandler`, `pushPendingSpec`, ...) that
      // expect `MutableRefObject<T>` keep working unchanged.
      const partitionAbortRef: MutableRefObject<AbortController | null> = {
        get current() { return ctrl.currentController; },
        set current(v: AbortController | null) { ctrl.currentController = v; },
      };
      const pendingSpecIdsShim: MutableRefObject<string[]> = {
        get current() { return ctrl.pendingSpecIds; },
        set current(v: string[]) { ctrl.pendingSpecIds = v; },
      };
      const pendingTaskIdsShim: MutableRefObject<string[]> = {
        get current() { return ctrl.pendingTaskIds; },
        set current(v: string[]) { ctrl.pendingTaskIds = v; },
      };

      const tryAutoRetry = (error: unknown): boolean => {
        // Never auto-retry if the user explicitly aborted the turn
        // (Stop button) — that controller is the same one we'd
        // re-attach to, so respect their intent.
        if (controller.signal.aborted) return false;
        if (ctrl.currentController?.signal.aborted) return false;
        if (ctrl.autoRetryCount >= MAX_AUTO_RETRIES) return false;
        const replayArgs = ctrl.lastSendArgs;
        if (!replayArgs) return false;
        ctrl.autoRetryCount += 1;
        // Phase 5 wiring: emit the auto-retry breadcrumb BEFORE
        // scheduling the timer so a future telemetry handler observes
        // the close + retry sequence on the same tick the original
        // close happened. Joins to `client_auto_retry_streamdropped`
        // on the server when the matching POST lands with
        // `X-Aura-Client-Retry`.
        const errorMessage =
          error instanceof Error ? error.message : typeof error === "string" ? error : "stream dropped";
        recordStreamCloseReason(
          {
            classified: "streamDropped",
            message: errorMessage,
            auto_retry: true,
          },
          breadcrumbContext,
        );
        const delayMs = 1000 * ctrl.autoRetryCount;
        // Discard any partial assistant state from the dropped turn
        // so the retry produces a clean assistant bubble. The user's
        // own message remains on screen because it's already in
        // `events` and the retry skips re-appending it.
        resetStreamBuffers(partitionRefs, partitionSetters);
        // Swap the would-be error bubble for a transient "Reconnecting"
        // banner. The next send will rehydrate from session history
        // (the harness picks up by `aura_session_id`).
        partitionSetters.setProgressText("Reconnecting…");
        // We can't fire the resend synchronously because the current
        // call is still on the stack and `inFlight` /
        // `setIsStreaming(true)` will fight a re-entrant invocation.
        // Defer past the surrounding `finally` so the latch is clear
        // by the time the retry runs. The replay always uses the
        // captured-partition path so it lands on the originating
        // partition's slot even if the panel has since switched to a
        // different agent.
        if (ctrl.retryTimer != null) clearTimeout(ctrl.retryTimer);
        ctrl.retryTimer = setTimeout(() => {
          ctrl.retryTimer = null;
          void (async () => {
            // Reconnect-first: the harness keeps the turn alive on a
            // passive SSE drop (Part A drop-guard), so try to rejoin
            // the still-live server stream before re-issuing the POST.
            // `resetStreamBuffers` above left this partition clean, so a
            // replay-from-cursor is dup-free. Only fall back to the
            // re-POST when no live stream is found.
            const reattached = await tryReattachActiveTurnRef.current?.(captured);
            if (reattached) return;
            ctrl.inAutoRetry = true;
            void performSendRef.current?.(replayArgs, captured);
          })();
        }, delayMs);
        return true;
      };

      const innerHandler = buildStreamHandler({
        projectId: capturedProjectId,
        agentInstanceId: capturedInstanceId,
        selectedModel,
        refs: partitionRefs,
        setters: partitionSetters,
        abortRef: partitionAbortRef,
        coreKey: capturedKey,
        // Phase 3: the handler migrates the partition key on
        // `SessionReady` (fresh-canvas → real session id) and on
        // auto-fork progress (mid-stream session id flip). It calls
        // back here so the in-flight closure in `performSend`
        // follows the new key for setters, breadcrumbs, and any
        // store reads/writes.
        onPartitionMigrated: (newKey) => {
          partitionState.key = newKey;
        },
        setProgressText: partitionSetters.setProgressText,
        sidekickRef,
        projectCtxRef,
        pendingSpecIdsRef: pendingSpecIdsShim,
        pendingTaskIdsRef: pendingTaskIdsShim,
        onSessionReady: (id) => onSessionReadyRef.current?.(id),
        onAssistantTurnCompleted: () => {
          ctrl.autoRetryCount = 0;
        },
        onMaybeAutoRetry: tryAutoRetry,
        workspaceToolsEnabled: workspaceToolsEnabledRef.current,
        workspaceStartAgentInstanceId: workspaceStartAgentInstanceIdRef.current,
        // Keep `ctrl.inFlight` consistent with `isStreaming` so the
        // dequeue-on-completion effect in `useChatPanelState` can
        // re-enter `performSend` the moment the turn ends. The outer
        // `finally` resets `inFlight` too, but only after the SSE
        // fully closes — by then the dequeue effect would already
        // have raced and been silently dropped by the latch.
        onStreamFinalized: () => {
          ctrl.inFlight = false;
        },
      });
      // Buffered SSE frames can still land in the handler closure
      // after this controller was aborted (browsers don't flush the
      // reader's internal queue synchronously with `abort()`). If a
      // "Send now" force-send has already taken over the partition,
      // letting those stale events through would clobber the new
      // turn's `isStreaming`/`ctrl.inFlight`/`streamBuffer` state.
      // Bail out before any handler work so the new turn owns the
      // partition uncontested.
      const handler: StreamEventHandler = {
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          innerHandler.onEvent(event);
        },
        onError: (error) => {
          if (controller.signal.aborted) return;
          innerHandler.onError(error);
        },
        onDone: innerHandler.onDone
          ? () => {
              if (controller.signal.aborted) return;
              innerHandler.onDone?.();
            }
          : undefined,
      };

      try {
        const shouldStartNewSession = ctrl.nextSendStartsNewSession;
        ctrl.nextSendStartsNewSession = false;
        if (_generationMode === "image") {
          partitionSetters.setProgressText("Generating image...");
          partitionSetters.setGenerationState({
            startedAt: Date.now(),
            model: selectedModel ?? null,
            kind: "image",
          });
          // Forward project + agent-instance ids so the server can
          // resolve the project chat session and persist this turn
          // into history — without it the synthesized `generate_image`
          // tool turn is in-memory only and is lost on hard reload.
          // Mirror the standalone-agent hook: pull the persisted
          // Image-mode quality from the chat-ui store under this
          // partition's key, forwarding it only for models that expose
          // a quality knob (Gemini and legacy non-GPT image ids keep provider defaults).
          const imageQuality = modelSupportsQuality(selectedModel)
            ? useChatUIStore.getState().getImageQuality(getPartitionKey())
            : null;
          await generateImageStream(
            userMsg.content,
            selectedModel,
            attachments,
            handler,
            controller.signal,
            { projectId: capturedProjectId, agentInstanceId: capturedInstanceId },
            shouldStartNewSession,
            shouldStartNewSession ? null : sessionIdRef.current,
            imageQuality,
          );
          return;
        }

        if (_generationMode === "3d") {
          // Chat 3D mode is a two-step in-bar pipeline:
          //   - no pinned source image → run the AURA-styled image
          //     step and pin the result so the next send can
          //     convert it to 3D;
          //   - pinned source image → run the image-to-3D model step
          //     against the pinned URL and clear the pin on
          //     completion.
          // The branch is keyed on `_sourceImageUrl`, which the
          // panel-state layer sources from the per-stream pinned
          // image slice in `chat-ui-store` (NOT from chat history).
          if (!_sourceImageUrl) {
            const styledPrompt = `${userMsg.content}${STYLE_LOCK_SUFFIX}`;
            partitionSetters.setProgressText("Generating image...");
            partitionSetters.setGenerationState({
              startedAt: Date.now(),
              model: DEFAULT_IMAGE_MODEL_ID,
              kind: "image",
            });
            await generateImageStream(
              styledPrompt,
              DEFAULT_IMAGE_MODEL_ID,
              attachments,
              {
                ...handler,
                onEvent(event) {
                  handler.onEvent(event);
                  if (
                    event.type === EventType.GenerationCompleted &&
                    event.content.mode === "image" &&
                    event.content.imageUrl
                  ) {
                    useChatUIStore.getState().setPinnedSourceImage(getPartitionKey(), {
                      imageUrl: event.content.imageUrl,
                      originalUrl: event.content.originalUrl,
                      // Persist the user's verbatim prompt (without the
                      // style suffix) so the thumb tooltip / future
                      // refinement chips read naturally.
                      prompt: userMsg.content,
                    });
                  }
                },
              },
              controller.signal,
              { projectId: capturedProjectId, agentInstanceId: capturedInstanceId },
              shouldStartNewSession,
              shouldStartNewSession ? null : sessionIdRef.current,
            );
            return;
          }
          partitionSetters.setProgressText("Generating 3D model...");
          partitionSetters.setGenerationState({
            startedAt: Date.now(),
            model: selectedModel ?? null,
            kind: "3d",
          });
          await generate3dStream(
            _sourceImageUrl.startsWith("data:")
              ? { kind: "data", imageData: _sourceImageUrl }
              : { kind: "url", imageUrl: _sourceImageUrl },
            trimmed || null,
            {
              ...handler,
              onEvent(event) {
                handler.onEvent(event);
                if (
                  event.type === EventType.GenerationCompleted &&
                  event.content.mode === "3d" &&
                  event.content.glbUrl
                ) {
                  useChatUIStore.getState().setPinnedSourceImage(getPartitionKey(), null);
                }
              },
            },
            controller.signal,
            capturedProjectId,
            undefined,
            undefined,
            capturedInstanceId,
            shouldStartNewSession,
            shouldStartNewSession ? null : sessionIdRef.current,
            selectedModel,
          );
          return;
        }

        if (_generationMode === "video") {
          core.setProgressText("Generating video...");
          partitionSetters.setGenerationState({
            startedAt: Date.now(),
            model: selectedModel ?? null,
            kind: "video",
          });
          const videoImages = attachments
            ?.filter((a) => a.type === "image")
            .map((a) => a.source_url ?? `data:${a.media_type};base64,${a.data}`);
          await generateVideoStream(
            {
              prompt: userMsg.content,
              model: selectedModel ?? undefined,
              images: videoImages,
              projectId,
              agentInstanceId,
              newSession: shouldStartNewSession,
              sessionId: shouldStartNewSession ? null : sessionIdRef.current,
            },
            handler,
            controller.signal,
          );
          return;
        }

        const modelForTurn = _generationMode ? null : selectedModel;
        // On an auto-retry call, surface the attempt number to the
        // server so it can bump `client_auto_retry_streamdropped`.
        // First sends pass `undefined` so no header is set.
        const clientRetryAttempt = isAutoRetry ? ctrl.autoRetryCount : undefined;
        // AURA Council fan-out for the project/instance chat — mirrors
        // the standalone agent path in `use-agent-chat-stream`. Resolved
        // from the live council store at send time (not capture time) so
        // queued / replayed sends reflect the current council state.
        // Built only for the regular chat path when council is active
        // (`councilCount > 1`) and at least two slots resolve to a model
        // id; otherwise left `undefined` so the single-model path is
        // byte-for-byte unchanged.
        const council = ((): {
          models: { id: string; reasoning_effort?: string }[];
          mechanism?: string;
        } | undefined => {
          if (_generationMode) return undefined;
          const uiState = useChatUIStore.getState();
          if (uiState.getAnswerStrategy(getPartitionKey()) === "second_opinion") {
            return undefined;
          }
          if (uiState.getCouncilCount(getPartitionKey()) <= 1) return undefined;
          const models = uiState
            .getCouncilModels(getPartitionKey())
            .filter((slot) => typeof slot.id === "string" && slot.id.length > 0)
            .map((slot) => {
              const effort = supportedReasoningEffort(slot.id, slot.effort);
              return {
                id: slot.id,
                ...(effort ? { reasoning_effort: effort } : {}),
              };
            });
          if (models.length < 2) return undefined;
          const mechanism = uiState.getCouncilMechanism(getPartitionKey());
          return { models, mechanism };
        })();
        const mixture = ((): {
          references: { id: string; reasoning_effort?: string }[];
          aggregator: { id: string; reasoning_effort?: string };
        } | undefined => {
          if (_generationMode || !selectedModel) return undefined;
          const uiState = useChatUIStore.getState();
          if (uiState.getAnswerStrategy(getPartitionKey()) !== "second_opinion") {
            return undefined;
          }
          const reference = uiState.getSecondOpinionReference(getPartitionKey());
          if (!reference?.id) return undefined;
          const aggregatorEffort = persistedReasoningEffort(selectedModel);
          const referenceEffort = supportedReasoningEffort(
            reference.id,
            reference.effort,
          );
          return {
            references: [
              {
                id: reference.id,
                ...(referenceEffort
                  ? { reasoning_effort: referenceEffort }
                  : {}),
              },
            ],
            aggregator: {
              id: selectedModel,
              ...(aggregatorEffort
                ? { reasoning_effort: aggregatorEffort }
                : {}),
            },
          };
        })();
        await api.sendEventStream(
          capturedProjectId,
          capturedInstanceId,
          userMsg.content,
          action,
          modelForTurn,
          attachments,
          handler,
          controller.signal,
          commands,
          shouldStartNewSession,
          shouldStartNewSession ? null : sessionIdRef.current,
          clientRetryAttempt,
          council,
          mixture,
          agentMentions,
          safeWorkspaceRef.current,
        );
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handleStreamError(partitionRefs, partitionSetters, err, breadcrumbContext);
      } finally {
        // Partition-scoped finalization sentinel. The legacy
        // `abortRef.current === controller` gate re-read
        // `streamMetaMap[currentKey]`, so after a panel swap the
        // gate failed and `setIsStreaming(false)` / sidekick spinner
        // cleanup never fired on the originating partition. The
        // captured `ctrl.currentController` is per-partition, so the
        // gate now correctly recognizes "this is still my turn"
        // regardless of which partition the panel is rendering.
        //
        // `ctrl.inFlight` is gated by the same sentinel: a "Send now"
        // path aborts THIS controller, calls `stopStreaming` (which
        // clears `ctrl.inFlight` synchronously), and immediately
        // dispatches a new `performSend` that flips `ctrl.inFlight`
        // back to true on its own controller. If we cleared
        // `ctrl.inFlight` unconditionally here, the aborted turn's
        // microtask-deferred `finally` would clobber the new send's
        // latch.
        if (ctrl.currentController === controller) {
          partitionSetters.setIsStreaming(false);
          sidekickRef.current.setAgentStreaming(capturedInstanceId, false);
          controller.abort();
          ctrl.currentController = null;
          ctrl.inFlight = false;
        }
        // Whatever path we took out (success, error, abort), drop any
        // placeholders that were never promoted. Safe because successful
        // promotions have already removed themselves from these arrays.
        for (const id of ctrl.pendingSpecIds) {
          sidekickRef.current.removeSpec(id);
        }
        ctrl.pendingSpecIds = [];
        for (const id of ctrl.pendingTaskIds) {
          sidekickRef.current.removeTask(id);
        }
        ctrl.pendingTaskIds = [];
      }
    },
    [],
  );

  // Mirror the live `performSend` identity into a ref so the
  // auto-retry timer can call the current closure even though
  // `tryAutoRetry` was scheduled from an older invocation.
  const performSendRef = useRef(performSend);
  useEffect(() => { performSendRef.current = performSend; }, [performSend]);

  /**
   * Rejoin an in-flight chat (or chat-driven spec-gen) turn for this
   * partition's pinned session by reattaching to the server's
   * registered `chat_turn` stream and feeding the SAME reducer
   * pipeline a live turn uses — so reattached deltas / tool cards /
   * thinking render identically.
   *
   * Dedup-safe by construction: this only ever runs when the local
   * partition buffer is clean (fresh mount, or right after
   * `resetStreamBuffers` in the auto-retry path). Because the attach
   * SSE is the SOLE source of per-delta content (the firehose carries
   * lifecycle only), a clean-buffer replay-from-cursor cannot
   * double-apply content the client already rendered. Returns `true`
   * when it found and attached to a live stream (caller should skip
   * any re-POST fallback), `false` otherwise.
   */
  const tryReattachActiveTurn = useCallback(
    async (captured: CapturedPartition): Promise<boolean> => {
      const {
        key: capturedKey,
        projectId: capturedProjectId,
        instanceId: capturedInstanceId,
      } = captured;
      const ctrl = getPartitionSendControl(capturedKey);
      // A local turn is already live / being sent on this partition, or
      // a reattach is already in flight — leave it alone.
      if (ctrl.inFlight || ctrl.reattaching) return false;
      const currentSessionId = sessionIdRef.current;
      // No pinned session id ⇒ nothing to match on (fresh canvas first
      // send goes through `sendMessage`, not reattach).
      if (!currentSessionId) return false;
      const listFn = api.streams?.listActiveStreams;
      if (!listFn) return false;

      ctrl.reattaching = true;
      let match: ActiveStreamSummary | null = null;
      try {
        const { streams } = await listFn({
          project_id: capturedProjectId,
          agent_instance_id: capturedInstanceId,
        });
        match = selectReattachableChatStream(streams, currentSessionId);
      } catch {
        ctrl.reattaching = false;
        return false;
      }
      // A fresh local send may have raced the discovery round-trip.
      if (!match || ctrl.inFlight) {
        ctrl.reattaching = false;
        return false;
      }

      const partitionState = { key: capturedKey };
      const getPartitionKey = (): string => partitionState.key;
      const partitionMeta = ensureEntry(capturedKey);
      const partitionRefs = partitionMeta.refs;
      const partitionSetters = createSetters(getPartitionKey);
      const breadcrumbContext: StreamCloseContext = {
        get streamKey() { return partitionState.key; },
        agentId: capturedInstanceId,
        sessionId: sessionIdRef.current ?? undefined,
      };

      ctrl.inFlight = true;
      // Clean slate ⇒ dup-free replay. Do NOT re-append the user bubble
      // (it's already in history/events — same guard as `isAutoRetry`).
      resetStreamBuffers(partitionRefs, partitionSetters);
      ctrl.pendingSpecIds = [];
      ctrl.pendingTaskIds = [];
      partitionSetters.setIsStreaming(true);
      sidekickRef.current.setAgentStreaming(capturedInstanceId, true);
      partitionSetters.setProgressText("Reconnecting…");

      ctrl.currentController?.abort();
      const controller = new AbortController();
      ctrl.currentController = controller;
      ctrl.activeAttachId = match.attach_id;

      const partitionAbortRef: MutableRefObject<AbortController | null> = {
        get current() { return ctrl.currentController; },
        set current(v: AbortController | null) { ctrl.currentController = v; },
      };
      const pendingSpecIdsShim: MutableRefObject<string[]> = {
        get current() { return ctrl.pendingSpecIds; },
        set current(v: string[]) { ctrl.pendingSpecIds = v; },
      };
      const pendingTaskIdsShim: MutableRefObject<string[]> = {
        get current() { return ctrl.pendingTaskIds; },
        set current(v: string[]) { ctrl.pendingTaskIds = v; },
      };

      // If the reattached SSE itself gives up (after its own internal
      // resume budget), recover the same way the live turn does:
      // re-discover the live stream, else re-POST the captured args.
      const onMaybeReconnect = (): boolean => {
        if (controller.signal.aborted) return false;
        if (ctrl.currentController?.signal.aborted) return false;
        if (ctrl.autoRetryCount >= MAX_AUTO_RETRIES) return false;
        ctrl.autoRetryCount += 1;
        resetStreamBuffers(partitionRefs, partitionSetters);
        partitionSetters.setProgressText("Reconnecting…");
        const replayArgs = ctrl.lastSendArgs;
        const delayMs = 1000 * ctrl.autoRetryCount;
        if (ctrl.retryTimer != null) clearTimeout(ctrl.retryTimer);
        ctrl.retryTimer = setTimeout(() => {
          ctrl.retryTimer = null;
          void (async () => {
            const reattached = await tryReattachActiveTurnRef.current?.(captured);
            if (reattached) return;
            // No live stream remains; only the auto-retry path (which
            // captured `lastSendArgs`) can re-issue. A bare mount-driven
            // reattach with no captured send simply gives up here and
            // lets the post-stream history refetch converge.
            if (!replayArgs) return;
            ctrl.inAutoRetry = true;
            void performSendRef.current?.(replayArgs, captured);
          })();
        }, delayMs);
        return true;
      };

      const innerHandler = buildStreamHandler({
        projectId: capturedProjectId,
        agentInstanceId: capturedInstanceId,
        selectedModel: null,
        refs: partitionRefs,
        setters: partitionSetters,
        abortRef: partitionAbortRef,
        coreKey: capturedKey,
        onPartitionMigrated: (newKey) => {
          partitionState.key = newKey;
        },
        setProgressText: partitionSetters.setProgressText,
        sidekickRef,
        projectCtxRef,
        pendingSpecIdsRef: pendingSpecIdsShim,
        pendingTaskIdsRef: pendingTaskIdsShim,
        onSessionReady: (id) => onSessionReadyRef.current?.(id),
        onAssistantTurnCompleted: () => {
          ctrl.autoRetryCount = 0;
        },
        onMaybeAutoRetry: onMaybeReconnect,
        workspaceToolsEnabled: workspaceToolsEnabledRef.current,
        workspaceStartAgentInstanceId: workspaceStartAgentInstanceIdRef.current,
        onStreamFinalized: () => {
          ctrl.inFlight = false;
        },
        breadcrumbContext,
      });
      const handler: StreamEventHandler = {
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          innerHandler.onEvent(event);
        },
        onError: (error) => {
          if (controller.signal.aborted) return;
          innerHandler.onError(error);
        },
        onDone: innerHandler.onDone
          ? () => {
              if (controller.signal.aborted) return;
              innerHandler.onDone?.();
            }
          : undefined,
      };

      try {
        await attachToStream(
          match.attach_id,
          ctrl.attachLastSeq,
          handler,
          controller.signal,
          {
            onSeq: (seq) => {
              if (seq > ctrl.attachLastSeq) ctrl.attachLastSeq = seq;
            },
            onResync: () => {
              // The backlog we asked for was evicted server-side. Drop
              // the partial and let the post-stream history refetch
              // (fired by the isStreaming → false transition below)
              // converge the panel instead of rendering a partial.
              resetStreamBuffers(partitionRefs, partitionSetters);
              ctrl.attachLastSeq = 0;
              controller.abort();
              if (ctrl.currentController === controller) {
                partitionSetters.setIsStreaming(false);
                sidekickRef.current.setAgentStreaming(capturedInstanceId, false);
                ctrl.currentController = null;
                ctrl.inFlight = false;
              }
            },
          },
        );
        return true;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return true;
        handleStreamError(partitionRefs, partitionSetters, err, breadcrumbContext);
        return true;
      } finally {
        ctrl.reattaching = false;
        if (ctrl.currentController === controller) {
          partitionSetters.setIsStreaming(false);
          sidekickRef.current.setAgentStreaming(capturedInstanceId, false);
          controller.abort();
          ctrl.currentController = null;
          ctrl.inFlight = false;
        }
        ctrl.activeAttachId = null;
        for (const id of ctrl.pendingSpecIds) {
          sidekickRef.current.removeSpec(id);
        }
        ctrl.pendingSpecIds = [];
        for (const id of ctrl.pendingTaskIds) {
          sidekickRef.current.removeTask(id);
        }
        ctrl.pendingTaskIds = [];
      }
    },
    [],
  );
  useEffect(() => {
    tryReattachActiveTurnRef.current = tryReattachActiveTurn;
  }, [tryReattachActiveTurn]);

  // Mount / session-pin reattach. On a fresh load or hard reload of a
  // panel pinned to a real session id, the harness may still be running
  // the last turn (Part A keeps it alive across passive SSE drops).
  // Fresh-mount buffers are empty, so a replay-from-0 reattach is
  // dup-free. Skips when a local turn is already in flight / streaming
  // for the partition. Best-effort; failures are swallowed inside
  // `tryReattachActiveTurn`.
  useEffect(() => {
    if (!projectId || !agentInstanceId) return;
    if (!sessionIdRef.current) return;
    const key = core.key;
    const ctrl = getPartitionSendControl(key);
    if (ctrl.inFlight || ctrl.reattaching || getIsStreaming(key)) return;
    const captured: CapturedPartition = {
      key,
      projectId,
      instanceId: agentInstanceId,
    };
    void tryReattachActiveTurnRef.current?.(captured);
  }, [projectId, agentInstanceId, sessionId, core.key]);

  const sendMessage = useCallback(
    async (
      content: string,
      action: string | null = null,
      selectedModel?: string | null,
      attachments?: ChatAttachment[],
      commands?: string[],
      _projectIdOverride?: string,
      _generationMode?: GenerationMode,
      _sourceImageUrl?: string,
      agentMentions?: import("../../api/streams").AgentMentionTarget[],
      clientMessageId?: string,
    ) => {
      if (!projectId || !agentInstanceId) return;
      const args: LastSendArgs = {
        content,
        action,
        selectedModel,
        attachments,
        commands,
        projectIdOverride: _projectIdOverride,
        generationMode: _generationMode,
        sourceImageUrl: _sourceImageUrl,
        agentMentions,
        clientMessageId,
      };
      const captured: CapturedPartition = {
        key: core.key,
        projectId,
        instanceId: agentInstanceId,
      };
      await performSend(args, captured);
    },
    [projectId, agentInstanceId, core.key, performSend],
  );

  const stopStreaming = useCallback(() => {
    const ctrl = getPartitionSendControl(core.key);
    if (ctrl.retryTimer != null) {
      clearTimeout(ctrl.retryTimer);
      ctrl.retryTimer = null;
    }
    ctrl.autoRetryCount = 0;
    // Phase 7 Stop / refresh cleanup: explicitly tell the server to
    // forward `HarnessInbound::Cancel` to the harness and evict the
    // warm chat session so the per-partition turn slot is released
    // immediately. Fire-and-forget — the server-side SSE drop guard
    // is the safety net if this POST never lands (offline, dropped
    // connection, etc.). Without this, a Stop on a long-running plan-
    // mode turn leaves the slot held until the 90s SSE idle timeout
    // and the next send appears to "time out" with no error surfaced.
    if (projectId && agentInstanceId) {
      api.cancelInstanceTurn(projectId, agentInstanceId).catch(() => {});
    }
    // The per-partition send-control refactor moved the controller
    // actually wired into the fetch off `streamMetaMap[key].abort`
    // and onto `ctrl.currentController`. `baseStopStreaming` still
    // aborts the former (used by task-stream + agent-chat flows), so
    // chat sends need an explicit abort of the partition controller
    // or the SSE reader keeps running after the user presses Stop.
    ctrl.currentController?.abort();
    ctrl.currentController = null;
    // Clear the sync re-entry latch in the same tick we abort. A
    // user-initiated "Send now" cancels the current turn and
    // immediately dispatches the queued prompt; if `ctrl.inFlight`
    // is still `true` (it only resets from `performSend`'s `finally`
    // once the SSE close propagates) the follow-up `performSend`
    // silently returns and the force-sent prompt is lost. Resetting
    // here is safe because the outer `finally` already gates its
    // cleanup on `ctrl.currentController === controller` — the prior
    // turn's tail will not clobber a freshly-issued send.
    ctrl.inFlight = false;
    core.baseStopStreaming();
    if (agentInstanceId) {
      sidekickRef.current.setAgentStreaming(agentInstanceId, false);
    }
    if (projectId && agentInstanceId) {
      const refetch = () => {
        api.getAgentInstance(projectId, agentInstanceId).then((instance) => {
          sidekickRef.current.notifyAgentInstanceUpdate(instance);
        }).catch(() => {});
      };
      setTimeout(refetch, 2000);
      setTimeout(refetch, 5000);
    }
  }, [projectId, agentInstanceId, core.key, core.baseStopStreaming]);

  // Stable callback identity so callers do not need to wrap it in a
  // `useRef` mirror. The control state it mutates is partition-keyed,
  // so the closure can be reused across renders without churning props
  // on memoized children.
  //
  // Phase 3 wiring: always target the lane's *fresh-canvas* partition
  // key (`sessionId === null`), not the panel's current `core.key`.
  // `useFreshCanvas.newChat()` calls this synchronously BEFORE it
  // drops `?session=` from the URL, so at this moment `core.key` still
  // reflects the about-to-be-stale real-session partition. Writing the
  // flag there would never be consumed because the next user send
  // fires on the `…:fresh` partition (the URL flip flips `sessionId`
  // to `null`, which flips `core.key` to the placeholder). Skipping
  // straight to the fresh-canvas key guarantees the pin lands on the
  // partition the very next send will actually read from — which is
  // both how the user expects "+ New chat" to behave and what makes
  // the server's `generate_session_title` task fire on the resulting
  // first user message of a brand-new storage session.
  const markNextSendAsNewSession = useCallback(() => {
    if (!projectId || !agentInstanceId) return;
    const freshKey = keyForProjectSession(projectId, agentInstanceId, null);
    const ctrl = getPartitionSendControl(freshKey);
    ctrl.nextSendStartsNewSession = true;
    // New chat means a fresh auto-retry budget for any future
    // transient WS drop on the new session.
    ctrl.autoRetryCount = 0;
    ctrl.lastSendArgs = null;
    if (ctrl.retryTimer != null) {
      clearTimeout(ctrl.retryTimer);
      ctrl.retryTimer = null;
    }
  }, [projectId, agentInstanceId]);

  return {
    streamKey: core.key,
    sendMessage,
    stopStreaming,
    resetEvents: core.resetEvents,
    markNextSendAsNewSession,
  };
}
