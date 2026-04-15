import type {
  ProjectId,
  Spec,
  Task,
} from "../types";
import type { AuraEvent } from "../types/aura-events";
import { EventType, isValidEventType, parseAuraEvent } from "../types/aura-events";
import type { SSECallbacks } from "./sse";
import { streamSSE } from "./sse";

export type { ChatAttachment } from "../types/aura-events";
import type { ChatAttachment } from "../types/aura-events";

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
      if (!isValidEventType(eventType)) return;
      handler.onEvent(parseAuraEvent(eventType, data, {}));
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

export function generate3dStream(
  imageUrl: string,
  prompt?: string | null,
  handler: StreamEventHandler = { onEvent: () => {}, onError: () => {} },
  signal?: AbortSignal,
  projectId?: string,
) {
  const body: Record<string, unknown> = { image_url: imageUrl };
  if (prompt) body.prompt = prompt;
  if (projectId) body.projectId = projectId;
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
