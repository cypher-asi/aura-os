import type {
  ProcessEvent,
  ProcessRunTranscriptEvent,
} from "../../../../types";
import type {
  DisplaySessionEvent,
  TimelineItem,
  ToolCallEntry,
} from "../../../../types/stream";
import {
  getPendingToolFallbackResult,
  prettyPrintIfJson,
} from "../NodeOutputTab/node-output-utils";
import { buildProcessEventDisplay } from "../ProcessEventOutput/process-event-display";

export interface ProcessNodeLabel {
  node_id: string;
  label: string;
}

export interface LiveCopyState {
  events: DisplaySessionEvent[];
  streamingText: string;
  thinkingText: string;
  activeToolCalls: ToolCallEntry[];
  timeline: TimelineItem[];
}

interface TranscriptNodeGroup {
  nodeId: string;
  label: string;
  entries: ProcessRunTranscriptEvent[];
}

interface CopyAllContext {
  events: ProcessEvent[];
  nodes: ProcessNodeLabel[];
  transcript: ProcessRunTranscriptEvent[];
  isActive: boolean;
  liveNodeLabel?: string | null;
  liveState?: LiveCopyState | null;
}

function formatToolCallForCopy(entry: ToolCallEntry): string {
  const parts = [`[tool_call: ${entry.name}]`];

  if (entry.result) {
    const errTag = entry.isError ? " (error)" : "";
    parts.push(`[tool_result: ${entry.name}${errTag}]\n${entry.result}`);
  }

  return parts.join("\n");
}

export function formatDisplayEventForCopy(message: DisplaySessionEvent): string {
  const parts: string[] = [];

  if (message.timeline && message.timeline.length > 0) {
    const toolCallMap = new Map(
      (message.toolCalls ?? []).map((entry) => [entry.id, entry]),
    );

    for (const item of message.timeline) {
      if (item.kind === "thinking") {
        if (message.thinkingText) {
          parts.push(`<thinking>\n${message.thinkingText}\n</thinking>`);
        }
        continue;
      }

      if (item.kind === "tool") {
        const entry = toolCallMap.get(item.toolCallId);
        if (entry) {
          parts.push(formatToolCallForCopy(entry));
        }
        continue;
      }

      if (item.content.trim()) {
        parts.push(item.content);
      }
    }
  } else {
    if (message.thinkingText) {
      parts.push(`<thinking>\n${message.thinkingText}\n</thinking>`);
    }
    if (message.toolCalls?.length) {
      parts.push(...message.toolCalls.map(formatToolCallForCopy));
    }
    if (message.content.trim()) {
      parts.push(message.content);
    }
  }

  return parts.join("\n\n").trim();
}

function formatProcessEventForCopy(
  event: ProcessEvent,
  nodes: ProcessNodeLabel[],
): string {
  if (event.status === "running" || event.status === "pending") {
    return "";
  }

  const label =
    nodes.find((node) => node.node_id === event.node_id)?.label ??
    event.node_id;
  const parts = [`## ${label} [${event.status}]`];
  const { message, separateOutput } = buildProcessEventDisplay(event);
  const displayText = message ? formatDisplayEventForCopy(message) : "";

  if (displayText) {
    parts.push(displayText);
  }

  if (separateOutput) {
    parts.push(prettyPrintIfJson(separateOutput));
  }

  if (event.input_snapshot) {
    parts.push(`--- Input ---\n${event.input_snapshot}`);
  }

  return parts.join("\n\n").trim();
}

export function groupTranscriptByNode(
  transcript: ProcessRunTranscriptEvent[],
  nodes: ProcessNodeLabel[],
): TranscriptNodeGroup[] {
  const groups: TranscriptNodeGroup[] = [];
  let current: TranscriptNodeGroup | null = null;

  for (const entry of transcript) {
    const payload = (entry.payload ?? {}) as Record<string, unknown>;
    const nodeId = typeof payload.node_id === "string" ? payload.node_id : "";
    if (!nodeId) continue;

    if (!current || current.nodeId !== nodeId) {
      current = {
        nodeId,
        label: nodes.find((node) => node.node_id === nodeId)?.label ?? nodeId,
        entries: [],
      };
      groups.push(current);
    }

    current.entries.push(entry);
  }

  return groups;
}

export function nodeTranscriptToEvents(
  entries: ProcessRunTranscriptEvent[],
): DisplaySessionEvent[] {
  const result: DisplaySessionEvent[] = [];
  let textBuf = "";
  let thinkingBuf = "";
  let tools: ToolCallEntry[] = [];
  let timeline: TimelineItem[] = [];
  let eventIdx = 0;
  let itemIdx = 0;
  let hasThinkingItem = false;
  let terminalStatus: "completed" | "failed" | "skipped" | undefined;

  const finalizePendingTranscriptTools = (
    toolCalls: ToolCallEntry[],
    status: "completed" | "failed" | "skipped" = "completed",
  ) => {
    for (const toolCall of toolCalls) {
      if (!toolCall.pending) continue;
      toolCall.pending = false;
      toolCall.started = false;
      toolCall.isError = status === "failed";
      toolCall.result = toolCall.result ?? getPendingToolFallbackResult(status);
    }
  };

  const flush = () => {
    if (!textBuf && !thinkingBuf && tools.length === 0) return;

    finalizePendingTranscriptTools(tools, terminalStatus);

    result.push({
      id: `transcript-${eventIdx++}`,
      role: "assistant",
      content: textBuf,
      toolCalls: tools.length > 0 ? [...tools] : undefined,
      thinkingText: thinkingBuf || undefined,
      timeline: timeline.length > 0 ? [...timeline] : undefined,
    });

    textBuf = "";
    thinkingBuf = "";
    tools = [];
    timeline = [];
    itemIdx = 0;
    terminalStatus = undefined;
  };

  for (const entry of entries) {
    const payload = (entry.payload ?? {}) as Record<string, unknown>;
    const type = String(payload.type ?? entry.event_type ?? "");

    switch (type) {
      case "text_delta": {
        const text = typeof payload.text === "string" ? payload.text : "";
        if (text) textBuf += text;
        break;
      }
      case "thinking_delta": {
        const thinking =
          (typeof payload.text === "string" ? payload.text : undefined) ??
          (typeof payload.thinking === "string" ? payload.thinking : "");
        if (thinking) {
          thinkingBuf += thinking;
          if (!hasThinkingItem) {
            timeline.push({ kind: "thinking", id: `tl-think-${itemIdx++}` });
            hasThinkingItem = true;
          }
        }
        break;
      }
      case "tool_use_start": {
        if (textBuf) {
          timeline.push({
            kind: "text",
            content: textBuf,
            id: `tl-text-${itemIdx++}`,
          });
          textBuf = "";
        }

        const id =
          typeof payload.id === "string" ? payload.id : crypto.randomUUID();
        const name = typeof payload.name === "string" ? payload.name : "tool";
        tools.push({ id, name, input: {}, pending: true, started: true });
        timeline.push({ kind: "tool", toolCallId: id, id: `tl-tool-${itemIdx++}` });
        break;
      }
      case "tool_call_snapshot": {
        const id = typeof payload.id === "string" ? payload.id : "";
        const name = typeof payload.name === "string" ? payload.name : "tool";
        const input =
          typeof payload.input === "object" && payload.input !== null
            ? (payload.input as Record<string, unknown>)
            : {};
        const existing = tools.find((toolCall) => toolCall.id === id);

        if (existing) {
          existing.name = name;
          existing.input = { ...existing.input, ...input };
        } else {
          const newId = id || crypto.randomUUID();
          tools.push({
            id: newId,
            name,
            input,
            pending: true,
            started: true,
          });
          timeline.push({
            kind: "tool",
            toolCallId: newId,
            id: `tl-tool-${itemIdx++}`,
          });
        }
        break;
      }
      case "tool_result": {
        const name = typeof payload.name === "string" ? payload.name : "tool";
        const toolUseId =
          typeof payload.tool_use_id === "string"
            ? payload.tool_use_id
            : undefined;
        const resultId =
          typeof payload.id === "string" ? payload.id : undefined;
        const resultText =
          typeof payload.result === "string" ? payload.result : "";
        const isError =
          typeof payload.is_error === "boolean" ? payload.is_error : false;
        const resolveId = toolUseId || resultId;
        const target =
          (resolveId
            ? tools.find((toolCall) => toolCall.id === resolveId)
            : undefined) ??
          [...tools].reverse().find((toolCall) => toolCall.pending && toolCall.name === name) ??
          [...tools].reverse().find((toolCall) => toolCall.pending);

        if (target) {
          target.result = resultText;
          target.isError = isError;
          target.pending = false;
          target.started = false;
        }
        break;
      }
      case "process_node_executed": {
        const status =
          typeof payload.status === "string"
            ? payload.status.toLowerCase()
            : "";
        if (status && !status.includes("running")) {
          terminalStatus = status.includes("failed")
            ? "failed"
            : status.includes("skipped")
              ? "skipped"
              : "completed";
          if (textBuf) {
            timeline.push({
              kind: "text",
              content: textBuf,
              id: `tl-text-${itemIdx++}`,
            });
            textBuf = "";
          }
          flush();
          hasThinkingItem = false;
        }
        break;
      }
      default:
        break;
    }
  }

  finalizePendingTranscriptTools(tools);

  if (textBuf) {
    timeline.push({ kind: "text", content: textBuf, id: `tl-text-${itemIdx++}` });
  }

  flush();
  return result;
}

function buildLiveStreamEvent(liveState: LiveCopyState): DisplaySessionEvent | null {
  const timeline =
    liveState.timeline.length > 0
      ? liveState.timeline
      : [
          ...(liveState.thinkingText
            ? [{ kind: "thinking", id: "live-thinking" } satisfies TimelineItem]
            : []),
          ...liveState.activeToolCalls.map(
            (toolCall) =>
              ({
                kind: "tool",
                toolCallId: toolCall.id,
                id: `live-tool-${toolCall.id}`,
              }) satisfies TimelineItem,
          ),
          ...(liveState.streamingText
            ? [
                {
                  kind: "text",
                  content: liveState.streamingText,
                  id: "live-text",
                } satisfies TimelineItem,
              ]
            : []),
        ];

  if (
    timeline.length === 0 &&
    !liveState.thinkingText &&
    liveState.activeToolCalls.length === 0 &&
    !liveState.streamingText
  ) {
    return null;
  }

  return {
    id: "live-output",
    role: "assistant",
    content: "",
    toolCalls:
      liveState.activeToolCalls.length > 0
        ? liveState.activeToolCalls
        : undefined,
    thinkingText: liveState.thinkingText || undefined,
    timeline: timeline.length > 0 ? timeline : undefined,
  };
}

export function buildProcessSidekickCopyText({
  events,
  nodes,
  transcript,
  isActive,
  liveNodeLabel,
  liveState,
}: CopyAllContext): string {
  const sections: string[] = [];

  const eventSections = events
    .map((event) => formatProcessEventForCopy(event, nodes))
    .filter(Boolean);
  if (eventSections.length > 0) {
    sections.push(["# Node Events", ...eventSections].join("\n\n"));
  }

  if (isActive && liveNodeLabel && liveState) {
    const liveEvent = buildLiveStreamEvent(liveState);
    const liveMessages = [
      ...liveState.events,
      ...(liveEvent ? [liveEvent] : []),
    ]
      .map((message) => formatDisplayEventForCopy(message))
      .filter(Boolean);

    if (liveMessages.length > 0) {
      sections.push(
        [`# Live Output: ${liveNodeLabel}`, ...liveMessages].join("\n\n"),
      );
    }
  }

  if (!isActive && transcript.length > 0) {
    const transcriptGroups = groupTranscriptByNode(transcript, nodes)
      .map((group) => {
        const messages = nodeTranscriptToEvents(group.entries)
          .map((message) => formatDisplayEventForCopy(message))
          .filter(Boolean);
        if (messages.length === 0) return "";
        return [`## ${group.label}`, ...messages].join("\n\n");
      })
      .filter(Boolean);

    if (transcriptGroups.length > 0) {
      sections.push(["# Run Output", ...transcriptGroups].join("\n\n"));
    }
  }

  return sections.join("\n\n").trim();
}
