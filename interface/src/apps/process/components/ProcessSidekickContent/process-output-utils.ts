import type {
  ProcessEvent,
} from "../../../../types";
import type {
  DisplaySessionEvent,
  TimelineItem,
  ToolCallEntry,
} from "../../../../types/stream";
import {
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

interface CopyAllContext {
  events: ProcessEvent[];
  nodes: ProcessNodeLabel[];
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

  return sections.join("\n\n").trim();
}
