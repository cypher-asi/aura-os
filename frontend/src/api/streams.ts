import type {
  ProjectId,
  SprintId,
  Sprint,
  Spec,
  Task,
  AgentInstance,
  Message,
} from "../types";
import { streamSSE } from "./sse";
import { resolveApiUrl } from "../lib/host-config";

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
  type: "image" | "text";
  media_type: string;
  data: string;
  name?: string;
}

export interface ChatStreamCallbacks {
  onDelta: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  onToolCall?: (info: ToolCallInfo) => void;
  onToolResult?: (info: ToolResultInfo) => void;
  onSpecSaved?: (spec: Spec) => void;
  onSpecsTitle?: (title: string) => void;
  onSpecsSummary?: (summary: string) => void;
  onTaskSaved?: (task: Task) => void;
  onMessageSaved?: (message: Message) => void;
  onAgentInstanceUpdated?: (instance: AgentInstance) => void;
  onTokenUsage?: (inputTokens: number, outputTokens: number) => void;
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
    resolveApiUrl(`/api/projects/${projectId}/sprints/${sprintId}/generate/stream`),
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
  return streamSSE<"progress" | "specs_title" | "specs_summary" | "delta" | "generating" | "spec_saved" | "task_saved" | "complete" | "error">(
    resolveApiUrl(`/api/projects/${projectId}/specs/generate/stream`),
    { method: "POST" },
    createSSEHandler(
      {
        progress: (d) => cb.onProgress(d.stage as string),
        specs_title: (d) => cb.onSpecsTitle?.(d.title as string),
        specs_summary: (d) => cb.onSpecsSummary?.(d.summary as string),
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

export function sendAgentMessageStream(
  agentId: string,
  content: string,
  action: string | null,
  _model?: string | null,
  attachments?: ChatAttachment[],
  cb: ChatStreamCallbacks = {} as ChatStreamCallbacks,
  signal?: AbortSignal,
) {
  const body: Record<string, unknown> = { content, action };
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }
  return streamSSE<"delta" | "thinking_delta" | "tool_call" | "tool_result" | "spec_saved" | "specs_title" | "specs_summary" | "task_saved" | "message_saved" | "agent_instance_updated" | "token_usage" | "error" | "done">(
    resolveApiUrl(`/api/agents/${agentId}/messages/stream`),
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
          case "thinking_delta":
            cb.onThinkingDelta?.(d.text as string);
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
          case "specs_title":
            cb.onSpecsTitle?.(d.title as string);
            break;
          case "specs_summary":
            cb.onSpecsSummary?.(d.summary as string);
            break;
          case "task_saved":
            cb.onTaskSaved?.(d.task as Task);
            break;
          case "message_saved":
            cb.onMessageSaved?.(d.message as Message);
            break;
          case "agent_instance_updated":
            cb.onAgentInstanceUpdated?.(d.agent_instance as AgentInstance);
            break;
          case "token_usage":
            cb.onTokenUsage?.(d.input_tokens as number, d.output_tokens as number);
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

export function sendMessageStream(
  projectId: ProjectId,
  agentInstanceId: string,
  content: string,
  action: string | null,
  _model?: string | null,
  attachments?: ChatAttachment[],
  cb: ChatStreamCallbacks = {} as ChatStreamCallbacks,
  signal?: AbortSignal,
) {
  const body: Record<string, unknown> = { content, action };
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }
  return streamSSE<"delta" | "thinking_delta" | "tool_call" | "tool_result" | "spec_saved" | "specs_title" | "specs_summary" | "task_saved" | "message_saved" | "agent_instance_updated" | "token_usage" | "error" | "done">(
    resolveApiUrl(`/api/projects/${projectId}/agents/${agentInstanceId}/messages/stream`),
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
          case "thinking_delta":
            cb.onThinkingDelta?.(d.text as string);
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
          case "specs_title":
            cb.onSpecsTitle?.(d.title as string);
            break;
          case "specs_summary":
            cb.onSpecsSummary?.(d.summary as string);
            break;
          case "task_saved":
            cb.onTaskSaved?.(d.task as Task);
            break;
          case "message_saved":
            cb.onMessageSaved?.(d.message as Message);
            break;
          case "agent_instance_updated":
            cb.onAgentInstanceUpdated?.(d.agent_instance as AgentInstance);
            break;
          case "token_usage":
            cb.onTokenUsage?.(d.input_tokens as number, d.output_tokens as number);
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
