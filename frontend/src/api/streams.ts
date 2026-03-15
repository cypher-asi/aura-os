import type {
  ProjectId,
  SprintId,
  Sprint,
  Spec,
  Task,
  ChatSession,
  ChatMessage,
} from "../types";
import { streamSSE } from "./sse";

const BASE_URL = "";

export interface SpecGenStreamCallbacks {
  onProgress: (stage: string) => void;
  onDelta: (text: string) => void;
  onGenerating: (tokens: number) => void;
  onSpecSaved: (spec: Spec) => void;
  onTaskSaved: (task: Task) => void;
  onComplete: (specs: Spec[]) => void;
  onError: (message: string) => void;
}

export interface SprintStreamCallbacks {
  onDelta: (text: string) => void;
  onGenerating: (inputTokens: number, outputTokens: number) => void;
  onDone: (sprint: Sprint) => void;
  onError: (message: string) => void;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultInfo {
  id: string;
  name: string;
  result: string;
  is_error: boolean;
}

export interface ChatAttachment {
  type: "image";
  media_type: string;
  data: string;
  name?: string;
}

export interface ChatStreamCallbacks {
  onDelta: (text: string) => void;
  onToolCall?: (info: ToolCallInfo) => void;
  onToolResult?: (info: ToolResultInfo) => void;
  onSpecSaved?: (spec: Spec) => void;
  onTaskSaved?: (task: Task) => void;
  onMessageSaved?: (message: ChatMessage) => void;
  onTitleUpdated?: (session: ChatSession) => void;
  onError: (message: string) => void;
  onDone?: () => void;
}

function createSSEHandler<E extends string>(
  handlers: Partial<Record<E, (data: Record<string, unknown>) => void>>,
  onError: (message: string) => void,
) {
  return {
    onEvent(eventType: E, data: unknown) {
      const d = data as Record<string, unknown>;
      const handler = handlers[eventType];
      if (handler) handler(d);
    },
    onError(err: Error) {
      onError(err.message);
    },
  };
}

export function generateSprintStream(
  projectId: ProjectId,
  sprintId: SprintId,
  cb: SprintStreamCallbacks,
  signal?: AbortSignal,
) {
  return streamSSE<"delta" | "generating" | "done" | "error">(
    `${BASE_URL}/api/projects/${projectId}/sprints/${sprintId}/generate/stream`,
    { method: "POST" },
    createSSEHandler(
      {
        delta: (d) => cb.onDelta(d.text as string),
        generating: (d) => cb.onGenerating(d.input_tokens as number, d.output_tokens as number),
        done: (d) => cb.onDone(d.sprint as Sprint),
        error: (d) => cb.onError(d.message as string),
      },
      cb.onError,
    ),
    signal,
  );
}

export function generateSpecsStream(
  projectId: ProjectId,
  cb: SpecGenStreamCallbacks,
  signal?: AbortSignal,
) {
  return streamSSE<"progress" | "delta" | "generating" | "spec_saved" | "task_saved" | "complete" | "error">(
    `${BASE_URL}/api/projects/${projectId}/specs/generate/stream`,
    { method: "POST" },
    createSSEHandler(
      {
        progress: (d) => cb.onProgress(d.stage as string),
        delta: (d) => cb.onDelta(d.text as string),
        generating: (d) => cb.onGenerating(d.tokens as number),
        spec_saved: (d) => cb.onSpecSaved(d.spec as Spec),
        task_saved: (d) => cb.onTaskSaved(d.task as Task),
        complete: (d) => cb.onComplete(d.specs as Spec[]),
        error: (d) => cb.onError(d.message as string),
      },
      cb.onError,
    ),
    signal,
  );
}

export function sendMessageStream(
  projectId: ProjectId,
  chatSessionId: string,
  content: string,
  action: string | null,
  model: string,
  attachments: ChatAttachment[] | undefined,
  cb: ChatStreamCallbacks,
  signal?: AbortSignal,
) {
  const body: Record<string, unknown> = { content, action, model };
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }
  return streamSSE<"delta" | "tool_call" | "tool_result" | "spec_saved" | "task_saved" | "message_saved" | "title_updated" | "error" | "done">(
    `${BASE_URL}/api/projects/${projectId}/chat-sessions/${chatSessionId}/messages/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    {
      onEvent(eventType, data) {
        const d = data as Record<string, unknown>;
        switch (eventType) {
          case "delta":
            cb.onDelta(d.text as string);
            break;
          case "tool_call":
            cb.onToolCall?.({
              id: d.id as string,
              name: d.name as string,
              input: d.input as Record<string, unknown>,
            });
            break;
          case "tool_result":
            cb.onToolResult?.({
              id: d.id as string,
              name: d.name as string,
              result: d.result as string,
              is_error: d.is_error as boolean,
            });
            break;
          case "spec_saved":
            cb.onSpecSaved?.(d.spec as Spec);
            break;
          case "task_saved":
            cb.onTaskSaved?.(d.task as Task);
            break;
          case "message_saved":
            cb.onMessageSaved?.(d.message as ChatMessage);
            break;
          case "title_updated":
            cb.onTitleUpdated?.(d.session as ChatSession);
            break;
          case "error":
            cb.onError(d.message as string);
            break;
          case "done":
            cb.onDone?.();
            break;
        }
      },
      onError(err) {
        cb.onError(err.message);
      },
      onDone() {
        cb.onDone?.();
      },
    },
    signal,
  );
}
