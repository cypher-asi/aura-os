import type {
  ProjectId,
  Spec,
  Task,
} from "../shared/types";
import type { AuraEvent } from "../shared/types/aura-events";
import { EventType, isValidEventType, parseAuraEvent } from "../shared/types/aura-events";
import { handleEngineEvent } from "../stores/event-store/engine-event-handlers";
import type { SSECallbacks } from "../shared/api/sse";
import { streamSSE } from "../shared/api/sse";

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
}

export interface ToolCallSnapshotInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
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
 * harness exhausted its internal streaming-retry budget and the
 * server's per-task `TOOL_CALL_RETRY_BUDGET` also gave up on
 * restarting the run; see
 * `apps/aura-os-server/src/handlers/dev_loop.rs`. The UI uses this
 * to flip the card into a terminal failed state with a red header.
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
) {
  const body: Record<string, unknown> = { content, action };
  if (model) body.model = model;
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }
  if (commands && commands.length > 0) {
    body.commands = commands;
  }
  if (projectId) body.project_id = projectId;
  if (newSession) body.new_session = true;
  return streamSSE<string>(
    `${BASE_URL}/api/agents/${agentId}/events/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    createChatStreamHandler(handler),
    signal,
  );
}

/* ── Generation streams (image / 3D) ─────────────────────────────── */

export function generateImageStream(
  prompt: string,
  model?: string | null,
  attachments?: ChatAttachment[],
  handler: StreamEventHandler = { onEvent: () => {}, onError: () => {} },
  signal?: AbortSignal,
  projectId?: string,
) {
  const body: Record<string, unknown> = { prompt };
  if (model) body.model = model;
  if (projectId) body.projectId = projectId;
  if (attachments && attachments.length > 0) {
    body.images = attachments
      .filter((a) => a.type === "image")
      .map((a) => `data:${a.media_type};base64,${a.data}`);
  }
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
  if (projectId) body.projectId = projectId;
  if (parentId) body.parentId = parentId;
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
) {
  const body: Record<string, unknown> = { content, action };
  if (model) body.model = model;
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }
  if (commands && commands.length > 0) {
    body.commands = commands;
  }
  if (newSession) body.new_session = true;
  return streamSSE<string>(
    `${BASE_URL}/api/projects/${projectId}/agents/${agentInstanceId}/events/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    createChatStreamHandler(handler),
    signal,
  );
}
