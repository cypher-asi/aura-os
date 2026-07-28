import type {
  ProjectId,
  Spec,
  Task,
} from "../shared/types";
import { loadPersistedModelEffort } from "../constants/models";
import type { AuraEvent } from "../shared/types/aura-events";
import { EventType, isValidEventType, parseAuraEvent } from "../shared/types/aura-events";
import { handleEngineEvent } from "../stores/event-store/engine-event-handlers";
import type { SSECallbacks } from "../shared/api/sse";
import { streamSSE } from "../shared/api/sse";
import type { ActiveStreamSummary } from "../shared/api/streams";

export type { ChatAttachment } from "../shared/types/aura-events";
import type { ChatAttachment } from "../shared/types/aura-events";

const BASE_URL = "";

/* ── Spec-gen stream (kept as-is; uses dedicated callbacks) ──────── */

export interface SpecGenStreamCallbacks {
  onProgress: (stage: string) => void;
  onSpecsTitle?: (title: string) => void;
  onSpecsSummary?: (summary: string) => void;
  onDelta: (text: string) => void;
  onGenerating: (tokens: number) => void;
  onSpecSaved: (spec: Spec) => void;
  onTaskSaved: (task: Task) => void;
  onComplete: (specs: Spec[]) => void;
  onError: (message: string) => void;
}

/* ── Tool info types (used by stream handlers) ───────────────────── */

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultInfo {
  id?: string;
  name: string;
  result: string;
  is_error: boolean;
}

export interface ToolCallStartedInfo {
  id: string;
  name: string;
  /**
   * `true` when the FE itself synthesised this tool-call lifecycle
   * (e.g. `emitSyntheticTransitionBlock` rendering a `transition_task`
   * card). Threaded onto the resulting `ToolCallEntry.synthetic` so
   * downstream consumers can filter decorative cards out of phase
   * label / has-content gates. See
   * `interface/src/shared/types/stream.ts::ToolCallEntry`.
   */
  synthetic?: boolean;
}

export interface ToolCallSnapshotInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** See {@link ToolCallStartedInfo.synthetic}. */
  synthetic?: boolean;
}

/**
 * Carries an in-flight streaming-retry attempt notification from
 * aura-harness out to the UI. `id` matches the live `tool_use_id`
 * on an existing {@link ToolCallEntry}; reducers find that entry
 * and flip `retrying=true` / `retryAttempt` / `retryMax` /
 * `retryReason` for the "Write retrying (n/8)…" header state.
 */
export interface ToolCallRetryingInfo {
  id: string;
  name: string;
  attempt: number;
  max_attempts: number;
  delay_ms: number;
  reason: string;
}

/**
 * Terminal harness-side failure for a tool call. Emitted after the
 * harness exhausted its internal streaming-retry budget; tool-level
 * retries are entirely the harness's responsibility now (the server
 * no longer maintains a parallel tool-call retry budget). The UI
 * uses this to flip the card into a terminal failed state with a
 * red header.
 */
export interface ToolCallFailedInfo {
  id: string;
  name: string;
  reason: string;
}

/* ── StreamEventHandler — single-callback replacement ────────────── */

export interface StreamEventHandler {
  onEvent: (event: AuraEvent) => void;
  onError: (error: unknown) => void;
  onDone?: () => void;
}

/* ── SSE helpers ─────────────────────────────────────────────────── */

function createSSEHandler<E extends string>(
  handlers: Partial<Record<E, (data: Record<string, unknown>) => void>>,
  onError: (message: string) => void,
): SSECallbacks<string> {
  return {
    onEvent(eventType: string, data: unknown) {
      const d = data as Record<string, unknown>;
      const handler = handlers[eventType as E];
      if (handler) handler(d);
    },
    onError(err: Error) {
      onError(err.message);
    },
  };
}

/* ── Resumable stream reattach ───────────────────────────────────── */

/**
 * Pick the live chat-turn stream a reattaching/reloading panel should
 * rejoin for a given storage `sessionId`. Plan-mode spec generation
 * runs over the chat stream and registers as `chat_turn` too, so this
 * single predicate covers both surfaces. Returns `null` when there is
 * no session pin or no matching non-terminated stream.
 *
 * Kept as a pure function (no I/O) so the per-session selection logic
 * the chat hooks rely on can be unit-tested in isolation.
 */
export function selectReattachableChatStream(
  streams: ActiveStreamSummary[],
  sessionId: string | null | undefined,
): ActiveStreamSummary | null {
  if (!sessionId) return null;
  return (
    streams.find(
      (s) =>
        s.kind === "chat_turn" &&
        !s.terminated &&
        s.scope.session_id === sessionId,
    ) ?? null
  );
}

/** Optional hooks for {@link attachToStream}. */
export interface AttachToStreamOptions {
  /**
   * Invoked with the numeric `seq` of each delivered frame (the SSE
   * `id:`). Callers persist this as the reattach cursor so a later
   * reattach can replay from exactly here instead of re-streaming the
   * whole backlog.
   */
  onSeq?: (seq: number) => void;
  /**
   * Invoked when the server reports the requested backlog was evicted
   * (`stream_resync_required`, carrying `last_seq`). The caller should
   * clear any partial buffers and converge via a fresh history fetch
   * rather than render a partial. The live SSE keeps flowing after
   * this frame, but the caller typically tears down and refetches.
   */
  onResync?: (lastSeq: number) => void;
}

/**
 * Reattach to a registered harness stream (`GET /api/streams/:id`),
 * replaying everything after `since` then streaming live. The request
 * is idempotent (GET) so {@link streamSSE}'s resume path can transparently
 * reconnect with an updated `?since=` cursor on a transient drop.
 *
 * Frames are forwarded as `AuraEvent`s through the same handler shape
 * the chat stream uses, so callers can route them into the relevant UI
 * surface (or through `handleEngineEvent`). The server's control frames
 * (`stream_resync_required`) are intercepted and surfaced via
 * {@link AttachToStreamOptions.onResync} rather than parsed as chat
 * events; `stream_heartbeat` frames are dropped by the chat-event
 * parser as before.
 */
export function attachToStream(
  attachId: string,
  since: number,
  handler: StreamEventHandler,
  signal?: AbortSignal,
  options?: AttachToStreamOptions,
) {
  const sinceParam = since > 0 ? `?since=${since}` : "";
  const inner = createChatStreamHandler(handler);
  const callbacks: SSECallbacks<string> = {
    onEvent(eventType, data) {
      const taggedType =
        data && typeof data === "object" && "type" in data && typeof data.type === "string"
          ? data.type
          : null;
      if (eventType === "stream_resync_required" || taggedType === "stream_resync_required") {
        const lastSeq =
          data && typeof data === "object" && "last_seq" in data
            ? Number((data as { last_seq?: unknown }).last_seq)
            : 0;
        options?.onResync?.(Number.isFinite(lastSeq) ? lastSeq : 0);
        return;
      }
      inner.onEvent(eventType, data);
    },
    onError: inner.onError,
    onDone: inner.onDone,
  };
  return streamSSE<string>(
    `${BASE_URL}/api/streams/${encodeURIComponent(attachId)}${sinceParam}`,
    { method: "GET" },
    callbacks,
    signal,
    { resumable: true, onSeq: options?.onSeq },
  );
}

function createChatStreamHandler(handler: StreamEventHandler): SSECallbacks<string> {
  return {
    onEvent(eventType: string, data: unknown) {
      const taggedType =
        data && typeof data === "object" && "type" in data && typeof data.type === "string"
          ? data.type
          : null;
      const resolvedType = isValidEventType(eventType)
        ? eventType
        : taggedType && isValidEventType(taggedType)
          ? taggedType
          : null;
      if (!resolvedType) return;
      const event = parseAuraEvent(resolvedType, data, {});
      if (resolvedType === EventType.SpecSaved || resolvedType === EventType.TaskSaved) {
        handleEngineEvent(event);
      }
      handler.onEvent(event);
    },
    onError(err: Error) {
      handler.onError(err);
    },
    onDone() {
      handler.onDone?.();
    },
  };
}

/* ── Spec generation stream ──────────────────────────────────────── */

export function generateSpecsStream(
  projectId: ProjectId,
  cb: SpecGenStreamCallbacks,
  agentInstanceId?: string | null,
  signal?: AbortSignal,
) {
  const params = agentInstanceId ? `?agent_instance_id=${encodeURIComponent(agentInstanceId)}` : "";
  return streamSSE<string>(
    `${BASE_URL}/api/projects/${projectId}/specs/generate/stream${params}`,
    { method: "POST" },
    createSSEHandler(
      {
        [EventType.Progress]: (d) => cb.onProgress(d.stage as string),
        [EventType.SpecsTitle]: (d) => cb.onSpecsTitle?.(d.title as string),
        [EventType.SpecsSummary]: (d) => cb.onSpecsSummary?.(d.summary as string),
        [EventType.Delta]: (d) => cb.onDelta(d.text as string),
        [EventType.SpecGenerating]: (d) => cb.onGenerating(d.tokens as number),
        [EventType.SpecSaved]: (d) => cb.onSpecSaved(d.spec as Spec),
        [EventType.TaskSaved]: (d) => cb.onTaskSaved(d.task as Task),
        [EventType.SpecGenComplete]: (d) => cb.onComplete(d.specs as Spec[]),
        [EventType.Error]: (d) => cb.onError(d.message as string),
      },
      cb.onError,
    ),
    signal,
  );
}

/* ── Chat / agent message streams ────────────────────────────────── */

export interface MultiModelSlot {
  id: string;
  reasoning_effort?: string;
}

export interface MixtureRequest {
  references: MultiModelSlot[];
  aggregator: MultiModelSlot;
}

/** Exact project binding selected from the chat composer's `@` menu. */
export interface AgentMentionTarget {
  agent_id: string;
  agent_instance_id: string;
}

export const MAX_AGENT_MENTIONS = 5;

export function sendAgentEventStream(
  agentId: string,
  content: string,
  action: string | null,
  model?: string | null,
  attachments?: ChatAttachment[],
  handler: StreamEventHandler = { onEvent: () => {}, onError: () => {} },
  signal?: AbortSignal,
  commands?: string[],
  projectId?: string,
  newSession?: boolean,
  sessionId?: string | null,
  /**
   * Phase 5 wiring: when the chat hook auto-retries a `streamDropped`
   * close, it bumps a per-turn counter and passes it here. The
   * server reads `X-Aura-Client-Retry: <n>` in `instance_route` /
   * `agent_route` to bump `client_auto_retry_streamdropped`. Pass
   * `undefined` (or 0) on first sends to skip the header entirely.
   */
  clientRetryAttempt?: number,
  /**
   * AURA Council fan-out. Set only when the user has council active
   * (`councilCount > 1`); `models[0]` is the synthesizer slot. The
   * server treats this as a Council runtime request only when
   * `models.length >= 2`, otherwise it falls back to `body.model` /
   * `body.reasoning_effort`. Each `reasoning_effort` is the same wire
   * string the single-model path emits (omitted for slots whose model
   * exposes no effort tiers). Left `undefined` for single-model sends
   * so that path is byte-for-byte unchanged. `mechanism` selects how the
   * council combines its members' answers (`synthesize` default /
   * `contrast` / `side_by_side`).
   */
  council?: {
    models: MultiModelSlot[];
    mechanism?: string;
  },
  /**
   * Second Opinion / Mixture-of-Agents request. The selected chat model
   * is the aggregator/final answer; reference models advise it. Aura OS
   * maps this onto the existing Council runtime today while preserving a
   * distinct request shape and UI presentation.
   */
  mixture?: MixtureRequest,
) {
  const body: Record<string, unknown> = { content, action };
  if (model) {
    body.model = model;
    // Reasoning effort is persisted per-model by the picker's effort
    // flyout, so we resolve it from the model id here rather than
    // threading it through the whole send pipeline. Omitted for models
    // that expose no effort tiers.
    const effort = loadPersistedModelEffort(model);
    if (effort) body.reasoning_effort = effort;
  }
  if (council) body.council = council;
  if (mixture) body.mixture = mixture;
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }
  if (commands && commands.length > 0) {
    body.commands = commands;
  }
  if (projectId) body.project_id = projectId;
  if (newSession) body.new_session = true;
  // `sessionId` pins this turn into a specific historical session.
  // The server validates that the pin belongs to the agent before
  // routing — see `try_pin_session` in `agent_route.rs`. Skipped when
  // `newSession` is set (force-new wins server-side too).
  if (sessionId && !newSession) body.session_id = sessionId;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof clientRetryAttempt === "number" && clientRetryAttempt >= 1) {
    // Server-side parser is in `instance_route.rs::header_indicates_client_retry`
    // — accepts any positive integer, ignores blanks / non-numeric.
    headers["X-Aura-Client-Retry"] = String(Math.floor(clientRetryAttempt));
  }
  return streamSSE<string>(
    `${BASE_URL}/api/agents/${agentId}/events/stream`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    createChatStreamHandler(handler),
    signal,
  );
}

/* ── Generation streams (image / 3D) ─────────────────────────────── */

/**
 * Optional chat-history scope for an image-mode generation. When the
 * caller is the chat input bar (project chat or standalone agent
 * chat), the server uses these ids to resolve the same chat session
 * the regular chat route writes into and persist this turn as a
 * normal `user_message` + `assistant_message_end` row pair — without
 * which the synthesized in-memory `generate_image` tool turn the UI
 * builds from `GenerationCompleted` is lost on hard reload.
 *
 * Either `agentId` (standalone agent chat) or both `projectId` and
 * `agentInstanceId` (project chat) should be set; the AURA 3D app
 * passes none and generation runs in the legacy in-memory-only mode.
 */
export interface GenerateImageChatScope {
  agentId?: string;
  projectId?: string;
  agentInstanceId?: string;
}

export function generateImageStream(
  prompt: string,
  model?: string | null,
  attachments?: ChatAttachment[],
  handler: StreamEventHandler = { onEvent: () => {}, onError: () => {} },
  signal?: AbortSignal,
  scope?: GenerateImageChatScope,
  /**
   * When true, force the server-side persistence layer to create a brand
   * new chat session for this turn instead of appending to the latest
   * existing one. Mirrors the `new_session` flag on `sendEventStream`
   * so the chat-input "+" affordance behaves identically across every
   * agent mode.
   */
  newSession?: boolean,
  /**
   * Pin this generation's persisted user/assistant rows into the
   * specified storage session id. Skipped when `newSession` is also
   * true (force-new wins server-side too).
   */
  sessionId?: string | null,
  /**
   * Optional image-quality tier (e.g. `low` / `medium` / `high` / `auto`
   * for GPT Image). Forwarded as `quality`; the server/router validate
   * it per model and ignore unsupported values.
   */
  quality?: string | null,
) {
  const body: Record<string, unknown> = { prompt };
  if (model) body.model = model;
  if (quality) body.quality = quality;
  if (scope?.projectId) body.projectId = scope.projectId;
  if (scope?.agentId) body.agentId = scope.agentId;
  if (scope?.agentInstanceId) body.agentInstanceId = scope.agentInstanceId;
  if (attachments && attachments.length > 0) {
    body.images = attachments
      .filter((a) => a.type === "image")
      .map((a) => a.source_url ?? `data:${a.media_type};base64,${a.data}`);
  }
  if (newSession) body.new_session = true;
  if (sessionId && !newSession) body.session_id = sessionId;
  return streamSSE<string>(
    `${BASE_URL}/api/generate/image/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    createChatStreamHandler(handler),
    signal,
  );
}

/**
 * Source image input for {@link generate3dStream}. Exactly one of
 * `imageUrl` or `imageData` must be supplied. `imageUrl` is used by
 * the AURA 3D app (an existing project artifact already lives at a
 * real URL); `imageData` (a `data:image/<type>;base64,...` string) is
 * used by chat 3D mode where the user pastes / uploads an image and
 * has no URL to point at — the backend decodes, persists, and forwards
 * the resulting URL to the 3D provider.
 *
 * Tripo itself supports text-to-3D, but our `aura-router` proxy
 * currently only exposes image-to-3D, so a source image is required.
 */
export type Generate3dSource =
  | { kind: "url"; imageUrl: string }
  | { kind: "data"; imageData: string };

export function generate3dStream(
  source: Generate3dSource | string,
  prompt?: string | null,
  handler: StreamEventHandler = { onEvent: () => {}, onError: () => {} },
  signal?: AbortSignal,
  projectId?: string,
  parentId?: string,
  agentId?: string,
  agentInstanceId?: string,
  /** See {@link generateImageStream} — same semantics. */
  newSession?: boolean,
  /** See {@link generateImageStream} — same semantics. */
  sessionId?: string | null,
  /**
   * 3D provider model id (e.g. `tripo-v2`). Forwarded as `model`; the
   * server/router fall back to the default provider when omitted.
   */
  model?: string | null,
) {
  // Keep the legacy positional `string` shape working for existing
  // callers (the AURA 3D app passes an image URL directly).
  const normalized: Generate3dSource =
    typeof source === "string" ? { kind: "url", imageUrl: source } : source;
  const body: Record<string, unknown> =
    normalized.kind === "url"
      ? { image_url: normalized.imageUrl }
      : { image_data: normalized.imageData };
  if (prompt) body.prompt = prompt;
  if (model) body.model = model;
  if (projectId) body.projectId = projectId;
  if (parentId) body.parentId = parentId;
  if (agentId) body.agentId = agentId;
  if (agentInstanceId) body.agentInstanceId = agentInstanceId;
  if (newSession) body.new_session = true;
  if (sessionId && !newSession) body.session_id = sessionId;
  return streamSSE<string>(
    `${BASE_URL}/api/generate/3d/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    createChatStreamHandler(handler),
    signal,
  );
}

export interface GenerateVideoOptions {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  durationSeconds?: number;
  resolution?: string;
  generateAudio?: boolean;
  projectId?: string;
  name?: string;
  agentId?: string;
  agentInstanceId?: string;
  /**
   * Source images for image-to-video ("animate this character"). Each
   * entry is a fully-resolved URL or a `data:<mime>;base64,...` string,
   * mirroring the `images` shape used by {@link generateImageStream}.
   */
  images?: string[];
  /** See {@link generateImageStream} — same semantics. */
  newSession?: boolean;
  /** See {@link generateImageStream} — same semantics. */
  sessionId?: string | null;
}

export function generateVideoStream(
  options: GenerateVideoOptions,
  handler: StreamEventHandler = { onEvent: () => {}, onError: () => {} },
  signal?: AbortSignal,
) {
  const body: Record<string, unknown> = { prompt: options.prompt };
  if (options.model) body.model = options.model;
  if (options.aspectRatio) body.aspectRatio = options.aspectRatio;
  if (options.durationSeconds) body.durationSeconds = options.durationSeconds;
  if (options.resolution) body.resolution = options.resolution;
  if (options.generateAudio !== undefined) body.generateAudio = options.generateAudio;
  if (options.images && options.images.length > 0) body.images = options.images;
  if (options.projectId) body.projectId = options.projectId;
  if (options.name) body.name = options.name;
  if (options.agentId) body.agentId = options.agentId;
  if (options.agentInstanceId) body.agentInstanceId = options.agentInstanceId;
  if (options.newSession) body.new_session = true;
  if (options.sessionId && !options.newSession) body.session_id = options.sessionId;
  return streamSSE<string>(
    `${BASE_URL}/api/generate/video/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    createChatStreamHandler(handler),
    signal,
  );
}

export function sendEventStream(
  projectId: ProjectId,
  agentInstanceId: string,
  content: string,
  action: string | null,
  model?: string | null,
  attachments?: ChatAttachment[],
  handler: StreamEventHandler = { onEvent: () => {}, onError: () => {} },
  signal?: AbortSignal,
  commands?: string[],
  newSession?: boolean,
  sessionId?: string | null,
  /**
   * Phase 5 wiring: when the chat hook auto-retries a `streamDropped`
   * close, it bumps a per-turn counter and passes it here. The
   * server reads `X-Aura-Client-Retry: <n>` in `instance_route` to
   * bump `client_auto_retry_streamdropped`. Pass `undefined` (or 0)
   * on first sends to skip the header entirely.
   */
  clientRetryAttempt?: number,
  /**
   * AURA Council fan-out for the project/instance chat. Mirrors
   * `sendAgentEventStream`: set only when council is active
   * (`councilCount > 1`), `models[0]` is the synthesizer slot, and the
   * server treats this as a Council runtime request only when
   * `models.length >= 2`. Left `undefined` for single-model sends so
   * that path is byte-for-byte unchanged. `mechanism` selects how the
   * council combines its members' answers (`synthesize` default /
   * `contrast` / `side_by_side`).
   */
  council?: {
    models: MultiModelSlot[];
    mechanism?: string;
  },
  /** See {@link sendAgentEventStream}. */
  mixture?: MixtureRequest,
  agentMentions?: AgentMentionTarget[],
  /**
   * Opt this project session into an isolated Git worktree with an automatic
   * filesystem checkpoint before the turn.
   */
  safeWorkspace?: boolean,
) {
  const body: Record<string, unknown> = { content, action };
  if (model) {
    body.model = model;
    // See `sendAgentEventStream` — effort is resolved from the persisted
    // per-model selection rather than threaded through the send path.
    const effort = loadPersistedModelEffort(model);
    if (effort) body.reasoning_effort = effort;
  }
  if (council) body.council = council;
  if (mixture) body.mixture = mixture;
  if (agentMentions && agentMentions.length > 0) {
    body.agent_mentions = agentMentions;
  }
  if (safeWorkspace) body.safe_workspace = true;
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }
  if (commands && commands.length > 0) {
    body.commands = commands;
  }
  if (newSession) body.new_session = true;
  // `sessionId` pins this turn into a specific historical session for
  // the project chat. Forwarded to the server as `session_id` so
  // `try_pin_session` in `instance_route.rs` can validate ownership.
  if (sessionId && !newSession) body.session_id = sessionId;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof clientRetryAttempt === "number" && clientRetryAttempt >= 1) {
    headers["X-Aura-Client-Retry"] = String(Math.floor(clientRetryAttempt));
  }
  return streamSSE<string>(
    `${BASE_URL}/api/projects/${projectId}/agents/${agentInstanceId}/events/stream`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    createChatStreamHandler(handler),
    signal,
  );
}
